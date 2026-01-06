import { defineNitroPlugin } from 'nitropack/runtime'

interface DurableAttachment {
  id?: string // connection id
  v?: string
  r?: string // route
  ip?: string // ip address
  s?: boolean // stats subscriber
}

interface DurableContext {
  getWebSockets: () => WebSocket[]
}

interface Peer {
  _internal?: {
    ws?: WebSocket & {
      serializeAttachment?: (state: DurableAttachment) => void
      deserializeAttachment?: () => DurableAttachment | null
    }
    durable?: { ctx?: DurableContext }
  }
}

interface ConnectionPayload {
  id: string
  version?: string
  route?: string
  ip?: string
  peer?: Peer
}

interface RouteUpdatePayload {
  id: string
  route: string
  peer?: Peer
}

interface SubscribeStatsPayload {
  id: string
  event?: { headers?: Headers }
  peer?: Peer
}

function getCtx(peer?: Peer): DurableContext | null {
  return peer?._internal?.durable?.ctx || null
}

function getStats(ctx: DurableContext, forId?: string) {
  const websockets = ctx.getWebSockets()
  const versions: Record<string, number> = {}
  const routes: Record<string, number> = {}
  const connections: { id: string, version: string, route: string, ip?: string }[] = []
  for (const ws of websockets) {
    const attachment = (ws as any).deserializeAttachment?.() || {}
    const id = attachment.id || 'unknown'
    const v = attachment.v || 'unknown'
    const r = attachment.r || '/'
    versions[v] = (versions[v] || 0) + 1
    routes[r] = (routes[r] || 0) + 1
    connections.push({ id, version: v, route: r, ip: attachment.ip })
  }
  return { total: websockets.length, versions, routes, connections, yourId: forId }
}

function broadcastToSubscribers(ctx: DurableContext) {
  const websockets = ctx.getWebSockets()
  const subscribers = websockets.filter((ws) => {
    const attachment = (ws as any).deserializeAttachment?.() || {}
    return attachment.s === true
  })
  if (subscribers.length === 0)
    return

  for (const ws of subscribers) {
    const attachment = (ws as any).deserializeAttachment?.() || {}
    const stats = getStats(ctx, attachment.id)
    ws.send(JSON.stringify({ type: 'stats', ...stats }))
  }
}

export default defineNitroPlugin((nitroApp) => {
  // @ts-expect-error custom hook
  nitroApp.hooks.hook('skew:connection:open', ({ id, version, route, ip, peer }: ConnectionPayload) => {
    const ws = peer?._internal?.ws
    if (ws?.serializeAttachment) {
      ws.serializeAttachment({ ...(ws.deserializeAttachment?.() || {}), id, v: version, r: route || '/', ip })
    }

    const ctx = getCtx(peer)
    if (ctx)
      broadcastToSubscribers(ctx)
  })

  // @ts-expect-error custom hook
  nitroApp.hooks.hook('skew:connection:route-update', ({ route, peer }: RouteUpdatePayload) => {
    const ws = peer?._internal?.ws
    if (ws?.serializeAttachment) {
      ws.serializeAttachment({ ...(ws.deserializeAttachment?.() || {}), r: route })
    }

    const ctx = getCtx(peer)
    if (ctx)
      broadcastToSubscribers(ctx)
  })

  // @ts-expect-error custom hook
  nitroApp.hooks.hook('skew:connection:close', ({ peer }: ConnectionPayload) => {
    const ctx = getCtx(peer)
    if (ctx)
      broadcastToSubscribers(ctx)
  })

  // @ts-expect-error custom hook
  nitroApp.hooks.hook('skew:subscribe-stats', async ({ id, event, peer }: SubscribeStatsPayload) => {
    const ws = peer?._internal?.ws
    const ctx = getCtx(peer)
    if (!ws || !ctx)
      return

    // Call auth hook
    let authorized = false
    // @ts-expect-error custom hook
    await nitroApp.hooks.callHook('skew:authorize-stats', {
      event,
      authorize: () => { authorized = true },
    })

    if (authorized) {
      ws.serializeAttachment?.({ ...(ws.deserializeAttachment?.() || {}), s: true })
      ws.send(JSON.stringify({ type: 'stats', ...getStats(ctx, id) }))
    }
    else {
      ws.send(JSON.stringify({ type: 'stats-unauthorized' }))
    }
  })
})
