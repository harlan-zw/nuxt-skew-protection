import type { CookieOptions } from 'nuxt/app'
import type { SkewProtectionRuntimeConfig } from '../../types'
import type { SkewConnection } from '../types'
import { useCookie, useNuxtApp, useRuntimeConfig, useState } from 'nuxt/app'
import { useSkewBotDetection } from '#skew-protection/bot-detection'
import { SKEW_MESSAGE_TYPE } from '../../const'
import { init, logger } from '../../shared/logger'

export interface SkewMessage {
  type: string
  version?: string
  connectionId?: string
  [key: string]: unknown
}

export interface CreateSkewConnectionConfig {
  name: string
  setup: (onMessage: (msg: SkewMessage) => void) => {
    cleanup?: () => void
    send?: (data: unknown) => void
  } | (() => void) | void
}

export function createSkewConnection(config: CreateSkewConnectionConfig): SkewConnection {
  const { name, setup } = config
  const nuxtApp = useNuxtApp()
  const runtimeConfig = useRuntimeConfig()
  const buildId = runtimeConfig.app.buildId

  // Initialize logger
  init()

  // Skip connection for bots using @nuxtjs/robots detection
  const isBot = useSkewBotDetection()
  const isConnected = useState('skew-connected', () => false)
  isConnected.value = false

  // Endpoint prefix for the SSE-fallback POST routes (`/route`,
  // `/subscribe-stats`). Mirrors the server route registration so a sub-path
  // deployment (e.g. `/pro/__skew`) hits its own worker.
  const basePath = (runtimeConfig.public.skewProtection as { basePath?: string }).basePath || '/__skew'

  // Initialize cookie first (always needed for return value)
  const cookieConfig = runtimeConfig.public.skewProtection.cookie as SkewProtectionRuntimeConfig['cookie']
  const cookie = cookieConfig === false
    ? undefined
    : (() => {
        const { name: cookieName, ...cookieOpts } = cookieConfig
        return useCookie(cookieName, { ...(cookieOpts as CookieOptions), readonly: false })
      })()

  if (isBot) {
    logger.debug(`[${name}] Skipping connection for bot`)
    return { connect: () => {}, disconnect: () => {}, send: () => {}, sendRoute: () => {}, subscribeStats: () => {}, buildId, cookie }
  }

  // Set cookie client-side if not already set
  if (import.meta.client && cookie && !cookie.value) {
    cookie.value = buildId
  }

  let cleanup: (() => void) | void
  let sendFn: ((data: unknown) => void) | undefined
  let connectionId: string | undefined
  let versionChannel: BroadcastChannel | undefined
  let latestVersion: string | undefined
  let generation = 0

  const handleMessage = (msg: SkewMessage) => {
    logger.debug(`[${name}] Received message:`, msg.type)
    if (msg.connectionId) {
      connectionId = msg.connectionId
    }
    if ((msg.type === SKEW_MESSAGE_TYPE.VERSION || msg.type === SKEW_MESSAGE_TYPE.CONNECTED) && typeof msg.version === 'string') {
      latestVersion = msg.version
      versionChannel?.postMessage({ type: 'version', version: msg.version })
    }
    nuxtApp.hooks.callHook('skew:message', msg)
  }

  const skewConfig = runtimeConfig.public.skewProtection
  let shareTransport = skewConfig.multiTab !== false
    && !skewConfig.connectionTracking
    && typeof BroadcastChannel !== 'undefined'
    && typeof navigator !== 'undefined'
    && !!navigator.locks
  const lockName = `nuxt-skew-protection:transport:${runtimeConfig.app.baseURL}:${basePath}:${name}`
  let lockRequest: AbortController | undefined
  let releaseLock: (() => void) | undefined
  let resumeAfterPageHide = false
  let subscriptionRequested = false

  const openTransport = () => {
    logger.debug(`[${name}] Connecting`)
    const openedGeneration = generation
    const result = setup((msg) => {
      if (generation === openedGeneration)
        handleMessage(msg)
    })
    // A synchronous subscription hook can disconnect or start a replacement.
    if (generation !== openedGeneration) {
      const close = result && typeof result === 'object' ? result.cleanup : result
      close?.()
      return
    }
    if (result && typeof result === 'object') {
      cleanup = result.cleanup
      sendFn = result.send
    }
    else {
      cleanup = result
    }
  }

  const connect = () => {
    subscriptionRequested = true
    if (shareTransport && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      resumeAfterPageHide = true
      return
    }
    if (isConnected.value)
      return
    generation++
    if (!shareTransport) {
      isConnected.value = true
      try {
        openTransport()
      }
      catch (error) {
        isConnected.value = false
        throw error
      }
      return
    }

    // Connected means subscribed to updates. Only the lock owner opens a socket.
    isConnected.value = true
    try {
      versionChannel = new BroadcastChannel(lockName)
    }
    catch (error) {
      logger.warn(`[${name}] Version channel unavailable; opening a tab connection:`, error)
      shareTransport = false
      isConnected.value = false
      connect()
      return
    }
    versionChannel.onmessage = ({ data }) => {
      if (data?.type === 'request-version' && releaseLock && latestVersion) {
        versionChannel?.postMessage({ type: 'version', version: latestVersion })
      }
      else if (data?.type === 'version' && typeof data.version === 'string') {
        // Only the version is shared, never another tab's connection identity.
        void Promise.resolve(nuxtApp.hooks.callHook('skew:message', { type: SKEW_MESSAGE_TYPE.VERSION, version: data.version }))
          .catch(error => logger.error(`[${name}] Version update hook failed:`, error))
      }
    }
    versionChannel.postMessage({ type: 'request-version' })
    const request = new AbortController()
    lockRequest = request
    let attemptedSetup = false
    void navigator.locks.request(lockName, { signal: request.signal }, () => {
      if (request.signal.aborted)
        return
      const holding = new Promise<void>((resolve) => {
        releaseLock = resolve
      })
      attemptedSetup = true
      openTransport()
      return holding
    }).catch((error: unknown) => {
      if (request.signal.aborted || lockRequest !== request)
        return
      if (attemptedSetup) {
        disconnect()
        logger.error(`[${name}] Could not open transport:`, error)
        return
      }
      logger.warn(`[${name}] Shared transport failed; opening a tab connection:`, error)
      try {
        openTransport()
      }
      catch (setupError) {
        disconnect()
        logger.error(`[${name}] Could not open transport:`, setupError)
      }
    })
  }

  const disconnect = () => {
    resumeAfterPageHide = false
    subscriptionRequested = false
    generation++
    isConnected.value = false
    logger.debug(`[${name}] Disconnecting`)
    const close = cleanup
    cleanup = undefined
    sendFn = undefined
    connectionId = undefined
    latestVersion = undefined
    versionChannel?.close()
    versionChannel = undefined
    lockRequest?.abort()
    lockRequest = undefined
    const release = releaseLock
    releaseLock = undefined
    // Release ownership even if a transport's cleanup throws.
    release?.()
    close?.()
  }

  const send = (data: unknown) => {
    if (!isConnected.value || !sendFn)
      return
    sendFn(data)
  }

  const sendRoute = (route: string) => {
    if (!isConnected.value)
      return
    // If we have a send function (WebSocket), use it directly
    if (sendFn) {
      sendFn({ type: 'route-update', route })
    }
    // Otherwise, POST to the route endpoint (SSE fallback)
    else if (connectionId) {
      fetch(`${basePath}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, route }),
      }).catch((error) => {
        logger.debug(`[${name}] Failed to send route update:`, error)
      })
    }
  }

  const subscribeStats = () => {
    if (!isConnected.value || !connectionId)
      return
    // Use WebSocket message if available (required for cloudflare-durable), fallback to POST for SSE
    if (sendFn) {
      sendFn({ type: SKEW_MESSAGE_TYPE.SUBSCRIBE_STATS })
    }
    else {
      fetch(`${basePath}/subscribe-stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ connectionId }),
      }).catch((error) => {
        logger.debug(`[${name}] Failed to subscribe to stats:`, error)
      })
    }
  }

  nuxtApp.hook('app:error', () => {
    // The update broadcast channel closes on app errors. Reconnect independently.
    shareTransport = false
    disconnect()
  })

  if (import.meta.client) {
    const suspend = () => {
      const wasRequested = subscriptionRequested
      disconnect()
      subscriptionRequested = wasRequested
      resumeAfterPageHide = wasRequested
    }
    const resume = () => {
      if (resumeAfterPageHide) {
        resumeAfterPageHide = false
        connect()
      }
    }
    window.addEventListener('pagehide', suspend)
    window.addEventListener('pageshow', resume)
    document.addEventListener('freeze', suspend)
    document.addEventListener('resume', resume)
    document.addEventListener('visibilitychange', () => {
      if (!shareTransport)
        return
      if (document.visibilityState === 'hidden')
        suspend()
      else
        resume()
    })
  }

  return { connect, disconnect, send, sendRoute, subscribeStats, buildId, cookie }
}
