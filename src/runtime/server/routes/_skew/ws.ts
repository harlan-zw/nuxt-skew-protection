import { defineWebSocketHandler } from 'h3'

interface SkewWebSocketPeer {
  id: string
  connectedAt: number
  lastPing?: number
}

// Store active WebSocket connections
const peers = new Map<any, SkewWebSocketPeer>()

export default defineWebSocketHandler({
  open(peer) {
    const peerInfo: SkewWebSocketPeer = {
      id: crypto.randomUUID(),
      connectedAt: Date.now(),
    }
    peers.set(peer, peerInfo)

    if (process.env.NODE_ENV === 'development') {
      console.log(`[skew-protection:ws] Client connected (${peerInfo.id}). Total connections: ${peers.size}`)
    }

    // Send initial connection acknowledgment
    peer.send(JSON.stringify({
      type: 'connected',
      timestamp: Date.now(),
    }))
  },

  message(peer, message) {
    try {
      const data = JSON.parse(message.text())
      const peerInfo = peers.get(peer)

      if (!peerInfo) {
        return
      }

      // Handle ping/pong for connection health
      if (data.type === 'ping') {
        peerInfo.lastPing = Date.now()
        peer.send(JSON.stringify({
          type: 'pong',
          timestamp: Date.now(),
        }))
      }
    }
    catch (error) {
      console.error('[skew-protection:ws] Error parsing message:', error)
    }
  },

  close(peer, event) {
    const peerInfo = peers.get(peer)
    if (peerInfo && process.env.NODE_ENV === 'development') {
      console.log(`[skew-protection:ws] Client disconnected (${peerInfo.id}). Reason: ${event.reason || 'unknown'}`)
    }
    peers.delete(peer)
  },

  error(peer, error) {
    const peerInfo = peers.get(peer)
    console.error(`[skew-protection:ws] Error for peer ${peerInfo?.id}:`, error)
  },
})

// Export function to broadcast version updates to all connected clients
export function broadcastVersionUpdate(newVersion: string) {
  const message = JSON.stringify({
    type: 'version-update',
    version: newVersion,
    timestamp: Date.now(),
  })

  let broadcastCount = 0
  for (const [peer] of peers) {
    try {
      peer.send(message)
      broadcastCount++
    }
    catch (error) {
      console.error('[skew-protection:ws] Error broadcasting to peer:', error)
      peers.delete(peer)
    }
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`[skew-protection:ws] Broadcasted version update (${newVersion}) to ${broadcastCount} clients`)
  }

  return broadcastCount
}

// Export peers map for use in Nitro plugins
export { peers }
