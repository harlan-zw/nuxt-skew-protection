import { useEventSource } from '@vueuse/core'
import { defineNuxtPlugin } from 'nuxt/app'
import { watch } from 'vue'
import { logger } from '../../shared/logger'
import { checkForUpdates, useSkewProtection } from '../composables/useSkewProtection'

export default defineNuxtPlugin({
  name: 'skew-protection:sse-updates',
  setup(nuxtApp) {
    const { clientVersion } = useSkewProtection()

    logger.debug('[SSE] Initializing SSE connection for version updates')

    const { data, status, error } = useEventSource(`/_skew/sse`, [], {
      autoReconnect: {
        retries: 10,
        delay: 5000,
        onFailed() {
          logger.error('[SSE] Max reconnection attempts reached')
        },
      },
      serializer: {
        // @ts-expect-error untyped
        read: rawData => JSON.parse(rawData),
      },
    })

    // Watch connection status
    watch(status, (newStatus) => {
      logger.debug(`[SSE] Connection status changed: ${newStatus}`)
    })

    // Watch for errors
    watch(error, (err) => {
      if (err)
        logger.debug('[SSE] Connection error:', err)
    })

    // Watch for incoming messages
    watch(data, (message) => {
      logger.debug('[SSE] Message received:', message)
      if (!message)
        return
      if (message.type === 'connected' && message.version) {
        const newVersion = message.version
        logger.debug(`[SSE] Server version: ${newVersion}, Client version: ${clientVersion}`)
        if (newVersion !== clientVersion) {
          logger.debug('[SSE] Version mismatch detected, triggering update check')
          nuxtApp.runWithContext(checkForUpdates)
        }
      }
    })
  },
})
