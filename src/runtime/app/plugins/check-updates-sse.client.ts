import { defineNuxtPlugin } from '#app'
import { useEventSource } from '@vueuse/core'
import { withQuery } from 'ufo'
import { watch } from 'vue'
import { logger } from '../../shared/logger'
import { fetchLatestManifest } from '../composables/fetchLatestManifest'
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
  setup() {
    const versionCookie = useSkewProtectionCookie()
    const clientVersion = versionCookie.value

    const { data } = useEventSource(withQuery(`/_skew/sse`), [], {
      autoReconnect: {
        retries: 10,
        delay: 5000,
        onFailed() {
          logger.error('SSE max reconnection attempts reached')
        },
      },
      serializer: {
        read: rawData => JSON.parse(rawData),
      },
    })

    // Watch for incoming messages
    watch(data, (message) => {
      logger.debug('SSE message received:', message)
      if (!message)
        return
      if (message.type === 'connected' && message.version) {
        const newVersion = message.version
        if (newVersion !== clientVersion) {
          // force refetch the manifest
          fetchLatestManifest()
        }
      }
    })
  },
})
