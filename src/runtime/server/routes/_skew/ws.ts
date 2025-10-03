import { defineWebSocketHandler } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

export default defineWebSocketHandler({
  open(peer) {
    const config = useRuntimeConfig()
    const serverVersion = config.app.buildId
    peer.send({
      type: 'connected',
      version: serverVersion,
      timestamp: Date.now(),
    })
  },

  message(peer, message) {
    if (message.text().includes('ping')) {
      peer.send('pong')
    }
  },
})
