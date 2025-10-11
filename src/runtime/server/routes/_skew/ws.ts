import { defineWebSocketHandler } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

export default defineWebSocketHandler({
  open(peer) {
    const runtimeConfig = useRuntimeConfig()
    peer.send(JSON.stringify({
      type: 'connected',
      version: runtimeConfig.app?.buildId,
      timestamp: Date.now(),
    }))
  },

  message(peer, message) {
    if (message.text().includes('ping')) {
      peer.send(JSON.stringify({ type: 'pong' }))
    }
  },
})
