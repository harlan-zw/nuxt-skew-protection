import { createError, defineEventHandler, getQuery, setHeaders } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { logger } from '../../logger'

interface SkewSSEConnection {
  id: string
  clientVersion: string
  connectedAt: number
  send: (data: string) => void
}

// Store active SSE connections (only works on long-running servers like Node)
const connections = new Map<string, SkewSSEConnection>()

/**
 * Server-Sent Events endpoint for real-time version updates
 *
 * On connection:
 * - Client sends their version via query param
 * - Server immediately responds if client is outdated
 * - Connection stays open for future updates
 *
 * Compatible with: Node.js, Bun, Deno
 * NOT compatible with: Cloudflare Workers (no persistent connections)
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const clientVersion = query.version as string

  if (!clientVersion) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing version query parameter',
    })
  }

  const config = useRuntimeConfig()
  const serverVersion = config.app.buildId

  const connectionId = crypto.randomUUID()

  // Set SSE headers
  setHeaders(event, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
  })

  // Create event stream
  const stream = event.node.res

  // Send helper function
  const send = (data: any) => {
    const message = `data: ${JSON.stringify(data)}\n\n`
    stream.write(message)
  }

  // Store connection
  const connection: SkewSSEConnection = {
    id: connectionId,
    clientVersion,
    connectedAt: Date.now(),
    send,
  }
  connections.set(connectionId, connection)

  if (process.env.NODE_ENV === 'development') {
    logger.info(`SSE client connected (${connectionId}). Total connections: ${connections.size}`)
  }

  // Send initial connection acknowledgment
  send({
    type: 'connected',
    timestamp: Date.now(),
  })

  // If client is already outdated, notify immediately
  if (clientVersion !== serverVersion) {
    send({
      type: 'version-update',
      version: serverVersion,
      timestamp: Date.now(),
    })

    if (process.env.NODE_ENV === 'development') {
      logger.info(`Client ${connectionId} is outdated (${clientVersion} vs ${serverVersion})`)
    }
  }

  // Send periodic keepalive (every 30 seconds)
  const keepaliveInterval = setInterval(() => {
    try {
      send({
        type: 'keepalive',
        timestamp: Date.now(),
      })
    }
    catch (error) {
      logger.error('Error sending keepalive:', error)
      cleanup()
    }
  }, 30000)

  // Cleanup on connection close
  const cleanup = () => {
    clearInterval(keepaliveInterval)
    connections.delete(connectionId)

    if (process.env.NODE_ENV === 'development') {
      logger.info(`SSE client disconnected (${connectionId}). Total connections: ${connections.size}`)
    }
  }

  // Handle client disconnect
  event.node.req.on('close', cleanup)
  event.node.req.on('error', cleanup)

  // Keep connection open
  return new Promise(() => {
    // Never resolve - keep stream open until client disconnects
  })
})

/**
 * Broadcast version update to all connected SSE clients
 * Called from Nitro plugin when new version is deployed
 */
export function broadcastVersionUpdate(newVersion: string): number {
  let broadcastCount = 0

  for (const [connectionId, connection] of connections) {
    try {
      connection.send({
        type: 'version-update',
        version: newVersion,
        timestamp: Date.now(),
      })
      broadcastCount++
    }
    catch (error) {
      logger.error(`Error broadcasting to connection ${connectionId}:`, error)
      connections.delete(connectionId)
    }
  }

  if (process.env.NODE_ENV === 'development') {
    logger.info(`Broadcasted version update (${newVersion}) to ${broadcastCount} SSE clients`)
  }

  return broadcastCount
}

/**
 * Get the number of active SSE connections
 */
export function getConnectionsCount(): number {
  return connections.size
}
