import type { CookieOptions } from 'nuxt/app'
import type { Ref } from 'vue'
import { useBotDetection } from '#imports'
import { useCookie, useNuxtApp, useRuntimeConfig } from 'nuxt/app'
import { init, logger } from '../../shared/logger'

export interface SkewMessage {
  type: string
  version?: string
  [key: string]: unknown
}

export interface CreateSkewConnectionConfig {
  name: string
  setup: (onMessage: (msg: SkewMessage) => void) => (() => void) | void
}

export interface SkewConnection {
  connect: () => void
  disconnect: () => void
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
    return { connect: () => {}, disconnect: () => {}, buildId, cookie }
  }

  // Set cookie client-side if not already set
  if (import.meta.client && !cookie.value) {
    cookie.value = buildId
  }

  let cleanup: (() => void) | void
  let isConnected = false

  const handleMessage = (msg: SkewMessage) => {
    logger.debug(`[${name}] Received message:`, msg.type)
    nuxtApp.hooks.callHook('skew:message', msg)
  }

  const connect = () => {
    if (isConnected)
      return
    isConnected = true
    logger.debug(`[${name}] Connecting`)
    cleanup = setup(handleMessage)
  }

  const disconnect = () => {
    if (!isConnected)
      return
    isConnected = false
    logger.debug(`[${name}] Disconnecting`)
    cleanup?.()
  }

  nuxtApp.hook('app:error', disconnect)

  if (import.meta.client) {
    window.addEventListener('beforeunload', disconnect)
  }

  return { connect, disconnect, buildId, cookie }
}
