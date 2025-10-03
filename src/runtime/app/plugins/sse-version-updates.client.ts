import { defineNuxtPlugin, useRuntimeConfig } from '#app'
import { logger } from '../../shared/logger'
import { useSkewProtectionCookie } from '../composables/useSkewProtectionCookie'

/**
 * SSE Version Updates Plugin
 *
 * Similar to Nuxt's check-outdated-build plugin, but uses Server-Sent Events
 * for real-time notifications instead of polling.
 *
 * Fires the same 'app:manifest:update' hook that Nuxt's chunk-reload plugin listens to.
 * This allows our SSE updates to integrate seamlessly with Nuxt's existing reload logic.
 *
 * Only enabled on platforms that support persistent connections (Node.js, Bun, Deno).
 * Auto-disabled on Cloudflare Workers.
 */
export default defineNuxtPlugin({
  name: 'skew-protection:sse-updates',
  setup(nuxtApp) {
    const config = useRuntimeConfig()
    const skewConfig = config.public.skewProtection

    const versionCookie = useSkewProtectionCookie()

    let eventSource: EventSource | null = null
    let reconnectAttempts = 0
    const maxReconnectAttempts = 10
    const reconnectDelay = 5000

    function connect() {
      if (eventSource) {
        eventSource.close()
      }

      const clientVersion = versionCookie.value
      const url = `/_skew/updates?version=${encodeURIComponent(clientVersion)}`

      try {
        eventSource = new EventSource(url)

        eventSource.onopen = () => {
          reconnectAttempts = 0
          if (skewConfig?.debug) {
            logger.info('SSE connection established')
          }
        }

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)

            if (data.type === 'version-update' && data.version) {
              const newVersion = data.version

              if (newVersion !== versionCookie.value) {
                // Fire Nuxt's standard hook - chunk-reload plugin will handle it
                nuxtApp.hooks.callHook('app:manifest:update', { id: newVersion })

                if (skewConfig?.debug) {
                  logger.info(`Version update received via SSE: ${newVersion}`)
                }
              }
            }
          }
          catch (error) {
            logger.error('Failed to parse SSE message:', error)
          }
        }

        eventSource.onerror = () => {
          if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++

            if (skewConfig?.debug) {
              logger.info(`SSE reconnecting (attempt ${reconnectAttempts}/${maxReconnectAttempts})...`)
            }

            setTimeout(connect, reconnectDelay)
          }
          else {
            logger.error('SSE max reconnection attempts reached')
          }
        }
      }
      catch (error) {
        logger.error('Failed to create SSE connection:', error)
      }
    }

    // Connect when app is ready
    nuxtApp.hook('app:mounted', connect)

    // Cleanup on unmount
    nuxtApp.hook('app:beforeUnmount', () => {
      if (eventSource) {
        eventSource.close()
        eventSource = null
      }
    })
  },
})
