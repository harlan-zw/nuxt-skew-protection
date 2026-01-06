import { defineNitroPlugin } from 'nitropack/runtime'

interface Connection {
  version: string
  route: string
  ip?: string
  send: (data: unknown) => void
}

interface ConnectionOpenPayload {
  id: string
  version: string
  route?: string
  ip?: string
  send: Connection['send']
  peer?: unknown
}

interface ConnectionClosePayload {
  id: string
}

interface RouteUpdatePayload {
  id: string
  route: string
}

interface SubscribeStatsPayload {
  id: string
  // H3Event for SSE (via POST), { headers } for WebSocket
  event?: { headers?: Headers } | unknown
}

export default defineNitroPlugin((nitroApp) => {
  const connections = new Map<string, Connection>()
  const statsSubscribers = new Set<string>()

  const getStats = (forId?: string) => {
    const versions: Record<string, number> = {}
    const routes: Record<string, number> = {}
    const connectionList: { id: string, version: string, route: string, ip?: string }[] = []
    for (const [id, conn] of connections.entries()) {
      versions[conn.version] = (versions[conn.version] || 0) + 1
      routes[conn.route] = (routes[conn.route] || 0) + 1
      connectionList.push({ id, version: conn.version, route: conn.route, ip: conn.ip })
    }
    return { total: connections.size, versions, routes, connections: connectionList, yourId: forId }
  }

  const broadcastToSubscribers = () => {
    if (statsSubscribers.size === 0)
      return
    for (const id of statsSubscribers) {
      const conn = connections.get(id)
      conn?.send({ type: 'stats', ...getStats(id) })
    }
  }

  // Expose stats via hook for server-side access (API endpoints)
  // @ts-expect-error custom hook
  nitroApp.hooks.hook('skew:stats', (callback: (stats: { total: number, versions: Record<string, number>, routes: Record<string, number> }) => void) => {
    callback(getStats())
  })

  // @ts-expect-error custom hook
  nitroApp.hooks.hook('skew:connection:open', ({ id, version, route, ip, send }: ConnectionOpenPayload) => {
    connections.set(id, { version, route: route || '/', ip, send })
    broadcastToSubscribers()
  })

  // @ts-expect-error custom hook
  nitroApp.hooks.hook('skew:connection:route-update', ({ id, route }: RouteUpdatePayload) => {
    const conn = connections.get(id)
    if (conn) {
      conn.route = route
      broadcastToSubscribers()
    }
  })

  // @ts-expect-error custom hook
  nitroApp.hooks.hook('skew:connection:close', ({ id }: ConnectionClosePayload) => {
    connections.delete(id)
    statsSubscribers.delete(id)
    broadcastToSubscribers()
  })

  // Subscribe to stats updates - requires auth via skew:authorize-stats hook
  // @ts-expect-error custom hook
  nitroApp.hooks.hook('skew:subscribe-stats', async ({ id, event }: SubscribeStatsPayload) => {
    let authorized = false
    // @ts-expect-error custom hook
    await nitroApp.hooks.callHook('skew:authorize-stats', {
      id,
      event,
      authorize: () => { authorized = true },
    })

    if (authorized) {
      statsSubscribers.add(id)
      const conn = connections.get(id)
      conn?.send({ type: 'stats', ...getStats(id) })
    }
    else {
      const conn = connections.get(id)
      conn?.send({ type: 'stats-unauthorized' })
    }
  })
})
