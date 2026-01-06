import type { SkewWebSocketConfig } from '../types'
import { useWebSocket } from '@vueuse/core'
import { defineNuxtPlugin, useNuxtApp, useRouter, useRuntimeConfig } from 'nuxt/app'
import { watch } from 'vue'
import { SKEW_MESSAGE_TYPE } from '../../const'
import { createSkewConnection } from '../utils/create-skew-connection'

export type { SkewWebSocketConfig }

export default defineNuxtPlugin({
  name: 'skew-protection:ws-updates',
  async setup() {
    const nuxtApp = useNuxtApp()
    const router = useRouter()
    const runtimeConfig = useRuntimeConfig()
    const routeTracking = (runtimeConfig.public.skewProtection as { routeTracking?: boolean })?.routeTracking
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'

    // Include initial route in connection URL if route tracking enabled
    const initialRoute = routeTracking ? `?route=${encodeURIComponent(router.currentRoute.value.path)}` : ''

    const config: SkewWebSocketConfig = {
      url: `${protocol}//${window.location.host}/_skew/ws${initialRoute}`,
      options: {
        autoReconnect: { retries: 10, delay: 5000 },
        immediate: false,
        // heartbeat disabled by default - saves server load and allows CF Durable Objects to hibernate
        // enable via skew:ws:config hook if your infrastructure has aggressive idle timeouts
      },
    }

    await nuxtApp.callHook('skew:ws:config', config)

    const skewConnection = createSkewConnection({
      name: 'WS',
      setup(onMessage) {
        const ws = useWebSocket(config.url, config.options)

        watch(ws.data, (raw: string | null) => {
          if (!raw)
            return
          const msg = JSON.parse(raw)
          if (msg.type === SKEW_MESSAGE_TYPE.PING)
            return
          onMessage(msg)
        })

        ws.open()

        return {
          cleanup: ws.close,
          send: (data: unknown) => ws.send(JSON.stringify(data)),
        }
      },
    })

    // Track route changes if enabled
    if (routeTracking) {
      router.afterEach((to) => {
        skewConnection.sendRoute(to.path)
      })
    }

    return { provide: { skewConnection } }
  },
})
