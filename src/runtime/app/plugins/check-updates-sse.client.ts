import type { SkewSSEConfig } from '../types'
import { useEventSource } from '@vueuse/core'
import { defineNuxtPlugin, useNuxtApp } from 'nuxt/app'
import { watch } from 'vue'
import { createSkewConnection } from '../utils/create-skew-connection'

export type { SkewSSEConfig }

export default defineNuxtPlugin({
  name: 'skew-protection:sse-updates',
  async setup() {
    const nuxtApp = useNuxtApp()

    const config: SkewSSEConfig = {
      url: '/_skew/sse',
      options: {
        autoReconnect: { retries: 10, delay: 5000 },
      },
    }

    await nuxtApp.callHook('skew:sse:config', config)

    const skewConnection = createSkewConnection({
      name: 'SSE',
      setup(onMessage) {
        const sse = useEventSource(config.url, [], config.options)

        watch(sse.data, (raw) => {
          if (!raw)
            return
          onMessage(JSON.parse(raw))
        })

        return sse.close
      },
    })

    return { provide: { skewConnection } }
  },
})
