import { defineNitroPlugin } from 'nitropack/runtime'

interface Connection {
  version: string
  route: string
  send: (data: unknown) => void
}

interface ConnectionOpenPayload {
  id: string
  version: string
  route?: string
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
  event?: { headers?: Headers }
}

export default defineNitroPlugin((nitroApp) => {
  const connections = new Map<string, Connection>()
  const statsSubscribers = new Set<string>()

  const getStats = () => {
    const versions: Record<string, number> = {}
    const routes: Record<string, number> = {}
    for (const conn of connections.values()) {
      versions[conn.version] = (versions[conn.version] || 0) + 1
      routes[conn.route] = (routes[conn.route] || 0) + 1
    }
    return { total: connections.size, versions, routes }
  }

  const broadcastToSubscribers = () => {
    if (statsSubscribers.size === 0)
      return
    const stats = getStats()
    for (const id of statsSubscribers) {
      const conn = connections.get(id)
      conn?.send({ type: 'stats', ...stats })
    }
  }

  // Expose stats via hook for server-side access (API endpoints)
  // @ts-expect-error custom hook
  nitroApp.hooks.hook('skew:stats', (callback: (stats: { total: number, versions: Record<string, number>, routes: Record<string, number> }) => void) => {
    callback(getStats())
  })

  // @ts-expect-error custom hook
  nitroApp.hooks.hook('skew:connection:open', ({ id, version, route, send }: ConnectionOpenPayload) => {
    connections.set(id, { version, route: route || '/', send })
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
    // Call auth hook - user must implement to authorize
    let authorized = false
    // @ts-expect-error custom hook
    await nitroApp.hooks.callHook('skew:authorize-stats', {
      id,
      event,
      authorize: () => { authorized = true },
    })

    if (authorized) {
      statsSubscribers.add(id)
      // Send initial stats immediately
      const conn = connections.get(id)
      conn?.send({ type: 'stats', ...getStats() })
    }
    else {
      const conn = connections.get(id)
      conn?.send({ type: 'stats-unauthorized' })
    }
  })
})
