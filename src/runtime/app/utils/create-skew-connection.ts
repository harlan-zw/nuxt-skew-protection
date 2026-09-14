import type { CookieOptions } from 'nuxt/app'
import type { SkewProtectionRuntimeConfig } from '../../types'
import type { SkewConnection } from '../types'
import { useCookie, useNuxtApp, useRuntimeConfig, useState } from 'nuxt/app'
import { useBotDetection } from '#imports'
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
  const { isBot } = useBotDetection()
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

  if (isBot.value) {
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

  const handleMessage = (msg: SkewMessage) => {
    logger.debug(`[${name}] Received message:`, msg.type)
    if (msg.connectionId) {
      connectionId = msg.connectionId
    }
    nuxtApp.hooks.callHook('skew:message', msg)
  }

  const connect = () => {
    if (isConnected.value)
      return
    logger.debug(`[${name}] Connecting`)
    const result = setup(handleMessage)
    isConnected.value = true
    if (result && typeof result === 'object') {
      cleanup = result.cleanup
      sendFn = result.send
    }
    else {
      cleanup = result
    }
  }

  const disconnect = () => {
    if (!isConnected.value)
      return
    isConnected.value = false
    logger.debug(`[${name}] Disconnecting`)
    const close = cleanup
    cleanup = undefined
    sendFn = undefined
    connectionId = undefined
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

  nuxtApp.hook('app:error', disconnect)

  if (import.meta.client) {
    window.addEventListener('beforeunload', disconnect)
  }

  return { connect, disconnect, send, sendRoute, subscribeStats, buildId, cookie }
}
