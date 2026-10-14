import { beforeEach, describe, expect, it, vi } from 'vitest'
import routeHandler from '../../src/runtime/server/routes/__skew/route.post'
import websocketHandler from '../../src/runtime/server/routes/__skew/ws'

const boundary = vi.hoisted(() => ({ body: undefined as unknown, callHook: vi.fn() }))
vi.mock('nuxt/server', () => ({
  defineEventHandler: (handler: unknown) => handler,
  readBody: async () => boundary.body,
}))
vi.mock('#nuxtseo/h3', () => ({ defineWebSocketHandler: (handler: unknown) => handler }))
vi.mock('#nuxtseo/nitro', () => ({ useNitroApp: () => ({ hooks: { callHook: boundary.callHook } }) }))
vi.mock('../../src/runtime/server/imports/cookie', () => ({ getSkewProtectionCookieName: () => undefined }))

beforeEach(() => {
  vi.clearAllMocks()
  boundary.callHook.mockResolvedValue(undefined)
})

describe('route request body', () => {
  it.each([
    null,
    { connectionId: 1, route: '/' },
    { connectionId: {}, route: '/' },
    { connectionId: 'client', route: {} },
    { connectionId: 'client', route: ['page'] },
    { connectionId: 'client', route: true },
  ])('ignores an invalid body: %j', async (body) => {
    boundary.body = body
    expect(await routeHandler({} as never)).toEqual({ ok: false })
    expect(boundary.callHook).not.toHaveBeenCalled()
  })

  it('updates a route from string fields', async () => {
    boundary.body = { connectionId: 'client', route: '/shopping' }
    expect(await routeHandler({} as never)).toEqual({ ok: true })
    expect(boundary.callHook).toHaveBeenCalledWith('skew:connection:route-update', { id: 'client', route: '/shopping' })
  })
})

describe('websocket messages', () => {
  it.each([null, [], 'message', { type: 'route-update', route: {} }, { type: 'route-update', route: true }])('ignores an invalid message: %j', (data) => {
    const peer = { id: 'client', send: vi.fn() }
    expect(() => websocketHandler.message!(peer as never, { text: () => JSON.stringify(data) } as never)).not.toThrow()
    expect(boundary.callHook).not.toHaveBeenCalled()
  })

  it('updates routes containing ping', () => {
    const peer = { id: 'client', send: vi.fn() }
    websocketHandler.message!(peer as never, { text: () => JSON.stringify({ type: 'route-update', route: '/shopping' }) } as never)
    expect(boundary.callHook).toHaveBeenCalledWith('skew:connection:route-update', { id: 'client', route: '/shopping', peer })
    expect(peer.send).not.toHaveBeenCalled()
  })

  it.each(['ping', JSON.stringify({ type: 'ping' })])('answers a ping message: %j', (text) => {
    const peer = { id: 'client', send: vi.fn() }
    websocketHandler.message!(peer as never, { text: () => text } as never)
    expect(peer.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }))
    expect(boundary.callHook).not.toHaveBeenCalled()
  })
})
