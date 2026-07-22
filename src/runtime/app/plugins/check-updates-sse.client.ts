import type { SkewSSEConfig } from '../types'
import { useEventSource } from '@vueuse/core'
import { defineNuxtPlugin, useNuxtApp, useRouter, useRuntimeConfig } from 'nuxt/app'
import { watch } from 'vue'
import { createSkewConnection } from '../utils/create-skew-connection'
import { resolveInitialRouteQuery, trackRouteChanges } from '../utils/route-tracking'

export type { SkewSSEConfig }

export default defineNuxtPlugin({
  name: 'skew-protection:sse-updates',
  async setup() {
    if (import.meta.prerender)
      return {}

    const nuxtApp = useNuxtApp()
    const router = useRouter()
    const runtimeConfig = useRuntimeConfig()
    const skewConfig = runtimeConfig.public.skewProtection as { routeTracking?: boolean, basePath?: string }
    const routeTracking = skewConfig?.routeTracking
    const basePath = skewConfig?.basePath || '/__skew'

    // Include initial route in connection URL if route tracking enabled
    const initialRoute = resolveInitialRouteQuery(routeTracking, router)

    const config: SkewSSEConfig = {
      url: `${basePath}/sse${initialRoute}`,
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

        return { cleanup: sse.close }
      },
    })

    // Track route changes if enabled
    trackRouteChanges(router, routeTracking, skewConnection)

    return { provide: { skewConnection } }
  },
})
