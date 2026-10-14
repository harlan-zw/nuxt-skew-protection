import { describe, expect, it, vi } from 'vitest'
import memoryPlugin from '../../src/runtime/server/plugins/connection-tracking'
import durablePlugin from '../../src/runtime/server/plugins/connection-tracking-cloudflare-durable'

vi.mock('#nuxtseo/nitro', () => ({ defineNitroPlugin: (plugin: unknown) => plugin }))

type Hook = (payload: any) => unknown

function createTracker(mode: 'memory' | 'durable') {
  const callbacks = new Map<string, Hook[]>()
  const messages: unknown[] = []
  const sockets: unknown[] = []
  const app = {
    hooks: {
      hook(name: string, callback: Hook) {
        callbacks.set(name, [...(callbacks.get(name) ?? []), callback])
      },
      async callHook(name: string, payload: unknown) {
        for (const callback of callbacks.get(name) ?? [])
          await callback(payload)
      },
    },
  }
  const receive = (message: unknown) => messages.push(typeof message === 'string' ? JSON.parse(message) : message)
  function connection(id: string) {
    let attachment: Record<string, unknown> = {}
    const ws = {
      serializeAttachment: (value: Record<string, unknown>) => { attachment = structuredClone(value) },
      deserializeAttachment: () => structuredClone(attachment),
      send: receive,
    }
    sockets.push(ws)
    return {
      id,
      version: 'build-fixture',
      route: '/',
      send: receive,
      peer: { _internal: { ws, durable: { ctx: { getWebSockets: () => sockets } } } },
    }
  }
  const plugin = mode === 'memory' ? memoryPlugin : durablePlugin
  // Nitro supplies more fields. These plugins consume only the hook boundary.
  plugin(app as never)
  return { app, messages, connection }
}

describe.each(['memory', 'durable'] as const)('%s stats subscriptions', (mode) => {
  it('stops broadcasts when a later subscription is denied', async () => {
    const { app, messages, connection } = createTracker(mode)
    const subscriber = connection('subscriber')
    app.hooks.hook('skew:authorize-stats', ({ event, authorize }) => {
      if (event.role === 'admin')
        authorize()
    })
    await app.hooks.callHook('skew:connection:open', subscriber)
    await app.hooks.callHook('skew:subscribe-stats', { ...subscriber, event: { role: 'admin' } })
    expect(messages.at(-1)).toMatchObject({ type: 'stats' })
    await app.hooks.callHook('skew:subscribe-stats', { ...subscriber, event: { role: 'viewer' } })
    expect(messages.at(-1)).toEqual({ type: 'stats-unauthorized' })
    messages.length = 0
    await app.hooks.callHook('skew:connection:route-update', { ...subscriber, route: '/next-page' })
    expect(messages).toEqual([])
  })

  it('stops broadcasts while a replacement authorization is pending', async () => {
    const { app, messages, connection } = createTracker(mode)
    const subscriber = connection('subscriber')
    let finish: (() => void) | undefined
    app.hooks.hook('skew:authorize-stats', async ({ event, authorize }) => {
      if (event.role === 'admin') {
        authorize()
      }
      else {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
      }
    })
    await app.hooks.callHook('skew:connection:open', subscriber)
    await app.hooks.callHook('skew:subscribe-stats', { ...subscriber, event: { role: 'admin' } })
    const pending = app.hooks.callHook('skew:subscribe-stats', { ...subscriber, event: { role: 'viewer' } })
    messages.length = 0
    await app.hooks.callHook('skew:connection:route-update', { ...subscriber, route: '/next-page' })
    expect(messages).toEqual([])
    finish!()
    await pending
  })

  it('keeps a denied subscription closed after an older check allows it', async () => {
    const { app, messages, connection } = createTracker(mode)
    const subscriber = connection('subscriber')
    let finish: (() => void) | undefined
    app.hooks.hook('skew:authorize-stats', async ({ event, authorize }) => {
      if (event.role === 'admin') {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        authorize()
      }
    })
    await app.hooks.callHook('skew:connection:open', subscriber)
    const earlier = app.hooks.callHook('skew:subscribe-stats', { ...subscriber, event: { role: 'admin' } })
    await app.hooks.callHook('skew:subscribe-stats', { ...subscriber, event: { role: 'viewer' } })
    finish!()
    await earlier
    messages.length = 0
    await app.hooks.callHook('skew:connection:route-update', { ...subscriber, route: '/next-page' })
    expect(messages).toEqual([])
  })

  it('keeps broadcasts closed when the authorization hook fails', async () => {
    const { app, messages, connection } = createTracker(mode)
    const subscriber = connection('subscriber')
    app.hooks.hook('skew:authorize-stats', ({ event, authorize }) => {
      if (event.role === 'admin')
        authorize()
      else
        throw new Error('Fixture authorization failure')
    })
    await app.hooks.callHook('skew:connection:open', subscriber)
    await app.hooks.callHook('skew:subscribe-stats', { ...subscriber, event: { role: 'admin' } })
    await expect(app.hooks.callHook('skew:subscribe-stats', { ...subscriber, event: { role: 'viewer' } })).rejects.toThrow('Fixture authorization failure')
    messages.length = 0
    await app.hooks.callHook('skew:connection:route-update', { ...subscriber, route: '/next-page' })
    expect(messages).toEqual([])
  })
})
