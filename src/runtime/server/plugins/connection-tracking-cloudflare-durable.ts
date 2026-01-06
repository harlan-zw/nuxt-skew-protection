import { defineNitroPlugin } from 'nitropack/runtime'

interface DurableAttachment {
  v?: string
  r?: string // route
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

function getStats(ctx: DurableContext) {
  const websockets = ctx.getWebSockets()
  const versions: Record<string, number> = {}
  const routes: Record<string, number> = {}
  for (const ws of websockets) {
    const attachment = (ws as any).deserializeAttachment?.() || {}
    const v = attachment.v || 'unknown'
    const r = attachment.r || '/'
    versions[v] = (versions[v] || 0) + 1
    routes[r] = (routes[r] || 0) + 1
  }
  return { total: websockets.length, versions, routes }
}

function broadcastToSubscribers(ctx: DurableContext) {
  const websockets = ctx.getWebSockets()
  const subscribers = websockets.filter((ws) => {
    const attachment = (ws as any).deserializeAttachment?.() || {}
    return attachment.s === true
  })
  if (subscribers.length === 0)
    return

  const stats = getStats(ctx)
  const msg = JSON.stringify({ type: 'stats', ...stats })
  for (const ws of subscribers) ws.send(msg)
}

export default defineNitroPlugin((nitroApp) => {
  // @ts-expect-error custom hook
  nitroApp.hooks.hook('skew:connection:open', ({ version, route, peer }: ConnectionPayload) => {
    const ws = peer?._internal?.ws
    if (ws?.serializeAttachment) {
      ws.serializeAttachment({ ...(ws.deserializeAttachment?.() || {}), v: version, r: route || '/' })
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
  nitroApp.hooks.hook('skew:subscribe-stats', async ({ event, peer }: SubscribeStatsPayload) => {
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
      ws.send(JSON.stringify({ type: 'stats', ...getStats(ctx) }))
    }
    else {
      ws.send(JSON.stringify({ type: 'stats-unauthorized' }))
    }
  })
})
