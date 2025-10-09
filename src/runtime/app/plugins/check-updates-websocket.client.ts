import { defineNuxtPlugin } from '#app'
import { useWebSocket } from '@vueuse/core'
import { watch } from 'vue'
import { logger } from '../../shared/logger'
import { useRuntimeConfigSkewProtection } from '../composables/useRuntimeConfigSkewProtection'
import { useSkewProtection } from '../composables/useSkewProtection'

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
  dependsOn: [
    'skew-protection:root',
  ],
  setup(nuxtApp) {
    const skewConfig = useRuntimeConfigSkewProtection()
    const skewProtection = useSkewProtection()
    const versionCookie = skewProtection.cookie
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = typeof window !== 'undefined'
      ? `${protocol}//${window.location.host}/_skew/ws`
      : ''

    const {
      status,
      data,
      open,
      close,
    } = useWebSocket(url, {
      autoReconnect: {
        retries: 10,
        delay: 5000,
        onFailed() {
          logger.error('WebSocket max reconnection attempts reached')
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

    // Watch for messages
    watch(data, (message: string | null) => {
      if (!message)
        return

      try {
        const parsed = JSON.parse(message)

        if (parsed.type === 'version-update' && parsed.version) {
          const newVersion = parsed.version

          if (newVersion !== versionCookie.value) {
            // Fire Nuxt's standard hook - chunk-reload plugin will handle it
            nuxtApp.hooks.callHook('app:manifest:update', {
              id: newVersion,
              timestamp: parsed.timestamp || Date.now(),
            })

            if (skewConfig.debug) {
              logger.info(`Version update received via WebSocket: ${newVersion}`)
            }
          }
        }
        else if (parsed.type === 'connected') {
          if (skewConfig.debug) {
            logger.info('WebSocket connection acknowledged')
          }
        }
        else if (parsed.type === 'pong') {
          // Keepalive response received
          if (skewConfig.debug) {
            logger.debug('Received pong from WebSocket')
          }
        }
      }
      catch (error) {
        logger.error('Failed to parse WebSocket message:', error)
      }
    })

    // Watch connection status
    watch(status, (newStatus: string) => {
      if (skewConfig.debug) {
        if (newStatus === 'OPEN') {
          logger.info('WebSocket connection established')
        }
        else if (newStatus === 'CONNECTING') {
          logger.info('WebSocket connecting...')
        }
        else if (newStatus === 'CLOSED') {
          logger.info('WebSocket connection closed')
        }
      }
    })

    // Connect when app is ready
    nuxtApp.hook('app:mounted', () => {
      open()
    })

    // Cleanup on app teardown
    nuxtApp.hook('app:error', () => {
      close()
    })
  },
})
