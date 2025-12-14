import { defineNitroPlugin } from 'nitropack/runtime'

interface DurableAttachment {
  v?: string
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
  peer?: Peer
}

function getCtx(peer?: Peer): DurableContext | null {
  return peer?._internal?.durable?.ctx || null
}

function getStats(ctx: DurableContext) {
  const websockets = ctx.getWebSockets()
  const versions: Record<string, number> = {}
  for (const ws of websockets) {
    const v = (ws as any).deserializeAttachment?.()?.v || 'unknown'
    versions[v] = (versions[v] || 0) + 1
  }
  return { total: websockets.length, versions }
}

function broadcast(ctx: DurableContext) {
  const stats = getStats(ctx)
  const msg = JSON.stringify({ type: 'stats', ...stats })
  for (const ws of ctx.getWebSockets()) ws.send(msg)
}

export default defineNitroPlugin((nitroApp) => {
  // @ts-expect-error custom hook
  nitroApp.hooks.hook('skew:connection:open', ({ version, peer }: ConnectionPayload) => {
    const ws = peer?._internal?.ws
    if (ws?.serializeAttachment) {
      ws.serializeAttachment({ ...(ws.deserializeAttachment?.() || {}), v: version })
    }

    const ctx = getCtx(peer)
    if (ctx)
      broadcast(ctx)
  })

  // @ts-expect-error custom hook
  nitroApp.hooks.hook('skew:connection:close', ({ peer }: ConnectionPayload) => {
    const ctx = getCtx(peer)
    if (ctx)
      broadcast(ctx)
  })
})
