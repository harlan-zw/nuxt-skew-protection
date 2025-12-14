import type { SkewWebSocketConfig } from '../types'
import { useWebSocket } from '@vueuse/core'
import { defineNuxtPlugin, useNuxtApp } from 'nuxt/app'
import { watch } from 'vue'
import { SKEW_MESSAGE_TYPE } from '../../const'
import { createSkewConnection } from '../utils/create-skew-connection'

export type { SkewWebSocketConfig }

export default defineNuxtPlugin({
  name: 'skew-protection:ws-updates',
  async setup() {
    const nuxtApp = useNuxtApp()
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'

    const config: SkewWebSocketConfig = {
      url: `${protocol}//${window.location.host}/_skew/ws`,
      options: {
        autoReconnect: { retries: 10, delay: 5000 },
        heartbeat: {
          message: JSON.stringify({ type: SKEW_MESSAGE_TYPE.PING, timestamp: Date.now() }),
          interval: 30000,
          pongTimeout: 10000,
        },
        immediate: false,
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
        return ws.close
      },
    })

    return { provide: { skewConnection } }
  },
})
