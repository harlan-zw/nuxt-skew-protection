import { DurableObject } from 'cloudflare:workers'

/**
 * Cloudflare Durable Object for managing real-time version updates via WebSocket
 *
 * This provides similar functionality to the SSE endpoint but works on Cloudflare Workers.
 * Clients connect via WebSocket and receive instant notifications when a new version is deployed.
 *
 * Usage:
 * 1. Configure in wrangler.toml:
 *    [[durable_objects.bindings]]
 *    name = "VERSION_UPDATES"
 *    class_name = "VersionUpdatesDO"
 *    script_name = "your-worker-name"
 *
 * 2. Enable in nuxt.config.ts:
 *    skewProtection: {
 *      durableObjects: true
 *    }
 */
export class VersionUpdatesDO extends DurableObject {
  private sessions: Map<string, WebSocket>
  private clientVersions: Map<string, string>

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env)
    this.sessions = new Map()
    this.clientVersions = new Map()

    // Accept WebSocket connections
    this.ctx.getWebSockets().forEach((ws) => {
      const meta = ws.deserializeAttachment()
      if (meta?.sessionId && meta?.clientVersion) {
        this.sessions.set(meta.sessionId, ws)
        this.clientVersions.set(meta.sessionId, meta.clientVersion)
      }
    })
  }

  /**
   * Handle HTTP requests to this Durable Object
   * Upgrade GET requests to WebSocket connections
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      const clientVersion = url.searchParams.get('version')
      if (!clientVersion) {
        return new Response('Missing version query parameter', { status: 400 })
      }

      const sessionId = crypto.randomUUID()
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)

      // Accept the WebSocket connection
      this.ctx.acceptWebSocket(server, [sessionId, clientVersion])

      // Store session
      this.sessions.set(sessionId, server)
      this.clientVersions.set(sessionId, clientVersion)

      // Attach metadata to WebSocket for persistence
      server.serializeAttachment({ sessionId, clientVersion })

      // Send initial connection acknowledgment
      server.send(JSON.stringify({
        type: 'connected',
        timestamp: Date.now(),
      }))

      // Check if client is already outdated
      const serverVersion = this.env?.NUXT_BUILD_ID || this.env?.buildId
      if (serverVersion && clientVersion !== serverVersion) {
        server.send(JSON.stringify({
          type: 'version-update',
          version: serverVersion,
          timestamp: Date.now(),
        }))
      }

      return new Response(null, {
        status: 101,
        webSocket: client,
      })
    }

    // Handle broadcast request (called when new version is deployed)
    if (request.method === 'POST' && url.pathname.endsWith('/broadcast')) {
      const { version } = await request.json() as { version: string }
      const broadcastCount = this.broadcastVersionUpdate(version)

      return new Response(JSON.stringify({
        success: true,
        broadcastCount,
        totalSessions: this.sessions.size,
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Status endpoint
    if (request.method === 'GET' && url.pathname.endsWith('/status')) {
      return new Response(JSON.stringify({
        sessions: this.sessions.size,
        clients: Array.from(this.clientVersions.entries()).map(([id, version]) => ({
          id,
          version,
        })),
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not found', { status: 404 })
  }

  /**
   * Handle WebSocket messages from clients
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      if (typeof message === 'string') {
        const data = JSON.parse(message)

        // Handle ping/pong for keepalive
        if (data.type === 'ping') {
          ws.send(JSON.stringify({
            type: 'pong',
            timestamp: Date.now(),
          }))
        }
      }
    }
    catch (error) {
      console.error('Error handling WebSocket message:', error)
    }
  }

  /**
   * Handle WebSocket connection close
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // Find and remove session
    for (const [sessionId, socket] of this.sessions) {
      if (socket === ws) {
        this.sessions.delete(sessionId)
        this.clientVersions.delete(sessionId)
        break
      }
    }
  }

  /**
   * Handle WebSocket errors
   */
  async webSocketError(ws: WebSocket, error: Error): Promise<void> {
    console.error('WebSocket error:', error)

    // Find and remove session
    for (const [sessionId, socket] of this.sessions) {
      if (socket === ws) {
        this.sessions.delete(sessionId)
        this.clientVersions.delete(sessionId)
        break
      }
    }
  }

  /**
   * Broadcast version update to all connected clients
   */
  private broadcastVersionUpdate(newVersion: string): number {
    let broadcastCount = 0

    for (const [sessionId, ws] of this.sessions) {
      try {
        ws.send(JSON.stringify({
          type: 'version-update',
          version: newVersion,
          timestamp: Date.now(),
        }))
        broadcastCount++
      }
      catch (error) {
        console.error(`Error broadcasting to session ${sessionId}:`, error)
        this.sessions.delete(sessionId)
        this.clientVersions.delete(sessionId)
      }
    }

    return broadcastCount
  }
}
