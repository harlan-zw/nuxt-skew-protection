import type { RequestEvent } from 'nuxt/server'
import type { H3Event } from '#nuxtseo/h3'
import { defineNitroPlugin } from '#nuxtseo/nitro'

interface DurableAttachment {
  id?: string // connection id
  v?: string
  r?: string // route
  ip?: string // ip address
  stats?: { _tag: 'Pending', request: string } | { _tag: 'Authorized' }
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
  peer?: unknown
}

interface RouteUpdatePayload {
  id: string
  route: string
  peer?: unknown
}

interface SubscribeStatsPayload {
  id: string
  event?: RequestEvent | H3Event | { headers?: Headers }
  peer?: unknown
}

function getInternal(peer: unknown): Peer['_internal'] {
  if (!peer || typeof peer !== 'object' || !('_internal' in peer))
    return undefined
  const internal = peer._internal
  if (!internal || typeof internal !== 'object')
    return undefined
  // CrossWS hides its adapter internals. This boundary reads the installed
  // Cloudflare adapter's trusted attachment and Durable Object interfaces.
  return internal as NonNullable<Peer['_internal']>
}

function getCtx(peer?: unknown): DurableContext | null {
  return getInternal(peer)?.durable?.ctx || null
}

function getOpenWebSockets(ctx: DurableContext) {
  return ctx.getWebSockets().filter(ws => ws.readyState === WebSocket.OPEN)
}

function getStats(ctx: DurableContext, forId?: string) {
  const websockets = getOpenWebSockets(ctx)
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
  const websockets = getOpenWebSockets(ctx)
  const subscribers = websockets.filter((ws) => {
    const attachment = (ws as any).deserializeAttachment?.() || {}
    return attachment.stats?._tag === 'Authorized'
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
  nitroApp.hooks.hook('skew:connection:open', ({ id, version, route, ip, peer }: ConnectionPayload) => {
    const ws = getInternal(peer)?.ws
    if (ws?.serializeAttachment) {
      ws.serializeAttachment({ ...(ws.deserializeAttachment?.() || {}), id, v: version, r: route || '/', ip })
    }

    const ctx = getCtx(peer)
    if (ctx)
      broadcastToSubscribers(ctx)
  })
  nitroApp.hooks.hook('skew:connection:route-update', ({ route, peer }: RouteUpdatePayload) => {
    const ws = getInternal(peer)?.ws
    if (ws?.serializeAttachment) {
      ws.serializeAttachment({ ...(ws.deserializeAttachment?.() || {}), r: route })
    }

    const ctx = getCtx(peer)
    if (ctx)
      broadcastToSubscribers(ctx)
  })
  nitroApp.hooks.hook('skew:connection:close', ({ peer }: ConnectionPayload) => {
    const ctx = getCtx(peer)
    if (ctx)
      broadcastToSubscribers(ctx)
  })
  nitroApp.hooks.hook('skew:subscribe-stats', async ({ id, event, peer }: SubscribeStatsPayload) => {
    const ws = getInternal(peer)?.ws
    const ctx = getCtx(peer)
    if (!ws || !ctx || ws.readyState !== WebSocket.OPEN)
      return

    const request = crypto.randomUUID()
    ws.serializeAttachment?.({ ...(ws.deserializeAttachment?.() || {}), stats: { _tag: 'Pending', request } })
    // Call auth hook
    let authorized = false
    await nitroApp.hooks.callHook('skew:authorize-stats', {
      event,
      authorize: () => { authorized = true },
    })

    const attachment = ws.deserializeAttachment?.()
    if (ws.readyState !== WebSocket.OPEN || attachment?.stats?._tag !== 'Pending' || attachment.stats.request !== request)
      return

    if (authorized) {
      ws.serializeAttachment?.({ ...attachment, stats: { _tag: 'Authorized' } })
      ws.send(JSON.stringify({ type: 'stats', ...getStats(ctx, id) }))
    }
    else {
      ws.serializeAttachment?.({ ...attachment, stats: undefined })
      ws.send(JSON.stringify({ type: 'stats-unauthorized' }))
    }
  })
})
