import { defineNuxtPlugin } from '#app'
import { useEventSource } from '@vueuse/core'
import { watch } from 'vue'
import { logger } from '../../shared/logger'
import { useSkewProtection } from '../composables/useSkewProtection'

export default defineNuxtPlugin({
  name: 'skew-protection:sse-updates',
  dependsOn: [
    'skew-protection:root',
  ],
  setup() {
    const skew = useSkewProtection()
    const clientVersion = skew.cookie.value

    const { data } = useEventSource(`/_skew/sse`, [], {
      autoReconnect: {
        retries: 10,
        delay: 5000,
        onFailed() {
          logger.error('SSE max reconnection attempts reached')
        },
      },
      serializer: {
        // @ts-expect-error untyped
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
          skew.checkForUpdates()
        }
      }
    })
  },
})
