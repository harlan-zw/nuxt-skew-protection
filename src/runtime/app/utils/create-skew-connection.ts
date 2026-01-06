import type { CookieOptions } from 'nuxt/app'
import type { Ref } from 'vue'
import { useBotDetection } from '#imports'
import { useCookie, useNuxtApp, useRuntimeConfig } from 'nuxt/app'
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

export interface SkewConnection {
  connect: () => void
  disconnect: () => void
  send: (data: unknown) => void
  sendRoute: (route: string) => void
  subscribeStats: () => void
  buildId: string
  cookie: Ref<string | null | undefined>
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

  // Initialize cookie first (always needed for return value)
  const cookieConfig = runtimeConfig.public.skewProtection.cookie
  const { name: cookieName, ...cookieOpts } = cookieConfig
  const cookie = useCookie(cookieName, { ...(cookieOpts as CookieOptions), readonly: false })

  if (isBot.value) {
    logger.debug(`[${name}] Skipping connection for bot`)
    return { connect: () => {}, disconnect: () => {}, send: () => {}, sendRoute: () => {}, subscribeStats: () => {}, buildId, cookie }
  }

  // Set cookie client-side if not already set
  if (import.meta.client && !cookie.value) {
    cookie.value = buildId
  }

  let cleanup: (() => void) | void
  let sendFn: ((data: unknown) => void) | undefined
  let isConnected = false
  let connectionId: string | undefined

  const handleMessage = (msg: SkewMessage) => {
    logger.debug(`[${name}] Received message:`, msg.type)
    if (msg.connectionId) {
      connectionId = msg.connectionId
    }
    nuxtApp.hooks.callHook('skew:message', msg)
  }

  const connect = () => {
    if (isConnected)
      return
    isConnected = true
    logger.debug(`[${name}] Connecting`)
    const result = setup(handleMessage)
    if (result && typeof result === 'object') {
      cleanup = result.cleanup
      sendFn = result.send
    }
    else {
      cleanup = result
    }
  }

  const disconnect = () => {
    if (!isConnected)
      return
    isConnected = false
    logger.debug(`[${name}] Disconnecting`)
    cleanup?.()
  }

  const send = (data: unknown) => {
    if (!isConnected || !sendFn)
      return
    sendFn(data)
  }

  const sendRoute = (route: string) => {
    if (!isConnected)
      return
    // If we have a send function (WebSocket), use it directly
    if (sendFn) {
      sendFn({ type: 'route-update', route })
    }
    // Otherwise, POST to the route endpoint (SSE fallback)
    else if (connectionId) {
      fetch('/_skew/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, route }),
      }).catch(() => {})
    }
  }

  const subscribeStats = () => {
    if (!isConnected || !connectionId)
      return
    fetch('/_skew/subscribe-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ connectionId }),
    }).catch(() => {})
  }

  nuxtApp.hook('app:error', disconnect)

  if (import.meta.client) {
    window.addEventListener('beforeunload', disconnect)
  }

  return { connect, disconnect, send, sendRoute, subscribeStats, buildId, cookie }
}
