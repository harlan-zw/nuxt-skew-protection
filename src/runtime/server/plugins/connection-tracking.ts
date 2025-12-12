import { defineNitroPlugin } from 'nitropack/runtime'

interface Connection {
  version: string
  send: (data: { type: string, total: number, versions: Record<string, number> }) => void
}

interface ConnectionOpenPayload {
  id: string
  version: string
  send: Connection['send']
}

interface ConnectionClosePayload {
  id: string
}

export default defineNitroPlugin((nitroApp) => {
  const connections = new Map<string, Connection>()

  const getStats = () => {
    const versions: Record<string, number> = {}
    for (const conn of connections.values()) {
      versions[conn.version] = (versions[conn.version] || 0) + 1
    }
    return { total: connections.size, versions }
  }

  const broadcast = () => {
    const stats = getStats()
    for (const conn of connections.values()) {
      conn.send({ type: 'stats', ...stats })
    }
  }

  // @ts-expect-error custom hook
  nitroApp.hooks.hook('skew:connection:open', ({ id, version, send }: ConnectionOpenPayload) => {
    connections.set(id, { version, send })
    broadcast()
  })

  // @ts-expect-error custom hook
  nitroApp.hooks.hook('skew:connection:close', ({ id }: ConnectionClosePayload) => {
    connections.delete(id)
    broadcast()
  })
})
