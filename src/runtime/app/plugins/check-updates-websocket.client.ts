import { useWebSocket } from '@vueuse/core'
import { defineNuxtPlugin, useRuntimeConfig } from 'nuxt/app'
import { watch } from 'vue'
import { logger, setLoggerDebugMode } from '../../shared/logger'
import { checkForUpdates, useSkewProtection } from '../composables/useSkewProtection'

/**
 * WebSocket Version Updates Plugin
 *
 * Similar to the SSE plugin, but uses WebSocket for real-time version notifications.
 * Works with any WebSocket-capable backend (Cloudflare Durable Objects, custom WebSocket servers, etc.)
 *
 * Fires the same 'app:manifest:update' hook that Nuxt's chunk-reload plugin listens to.
 * This allows our WebSocket updates to integrate seamlessly with Nuxt's existing reload logic.
 *
 * Can be used on:
 * - Cloudflare Workers with Durable Objects
 * - Custom WebSocket servers
 * - Any platform that supports WebSocket connections
 */
export default defineNuxtPlugin({
  name: 'skew-protection:websocket-updates',
  setup(nuxtApp) {
    const config = useRuntimeConfig()
    setLoggerDebugMode(config.public.skewProtection.debug)

    const { clientVersion } = useSkewProtection()

    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = typeof window !== 'undefined'
      ? `${protocol}//${window.location.host}/_skew/ws`
      : ''

    logger.debug(`[WS] Initializing WebSocket connection: ${url}`)

    const {
      data,
      status,
      open,
      close,
    } = useWebSocket(url, {
      autoReconnect: {
        retries: 10,
        delay: 5000,
        onFailed() {
          logger.error('[WS] Max reconnection attempts reached')
        },
      },
      heartbeat: {
        message: JSON.stringify({
          type: 'ping',
          timestamp: Date.now(),
        }),
        interval: 30000, // Every 30 seconds
        pongTimeout: 10000,
      },
      immediate: false, // Don't connect immediately, wait for app:mounted
    })

    // Watch connection status
    watch(status, (newStatus) => {
      logger.debug(`[WS] Connection status changed: ${newStatus}`)
    })

    // Watch for messages
    watch(data, (message: string | null) => {
      if (!message)
        return

      try {
        const parsed = JSON.parse(message)
        logger.debug('[WS] Message received:', parsed)

        if (parsed.type === 'ping') {
          logger.debug('[WS] Heartbeat ping')
          return
        }

        if (parsed.version) {
          const newVersion = parsed.version
          logger.debug(`[WS] Server version: ${newVersion}, Client version: ${clientVersion}`)

          if (newVersion !== clientVersion) {
            logger.debug('[WS] Version mismatch detected, triggering update check')
            // Fire Nuxt's standard hook - chunk-reload plugin will handle it
            nuxtApp.runWithContext(checkForUpdates)
          }
        }
      }
      catch (error) {
        logger.error('[WS] Failed to parse WebSocket message:', error)
      }
    })

    // Connect when app is ready
    nuxtApp.hook('app:mounted', () => {
      logger.debug('[WS] App mounted, opening connection')
      open()
    })

    // Cleanup on app teardown
    nuxtApp.hook('app:error', () => {
      logger.debug('[WS] App error, closing connection')
      close()
    })

    // Cleanup on page unload
    if (import.meta.client) {
      window.addEventListener('beforeunload', () => {
        logger.debug('[WS] Page unload, closing connection')
        close()
      })
    }
  },
})
