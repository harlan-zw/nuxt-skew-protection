import { beforeEach, describe, expect, it, vi } from 'vitest'

const callHook = vi.fn()

vi.mock('#nuxtseo/h3', () => ({
  defineWebSocketHandler: vi.fn((handler: unknown) => handler),
}))

vi.mock('#nuxtseo/nitro', () => ({
  useNitroApp: vi.fn(() => ({ hooks: { callHook } })),
  useRuntimeConfig: vi.fn(() => ({ app: { buildId: 'server-build-id' } })),
}))

vi.mock('../../src/runtime/server/imports/cookie', () => ({
  getSkewProtectionCookieName: vi.fn(() => undefined),
}))

describe('websocket version tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the server version when cookies are disabled', async () => {
    const { default: handler } = await import('../../src/runtime/server/routes/__skew/ws')
    const peer = {
      id: 'peer-id',
      request: {
        headers: new Headers({ cookie: '__nkpv=stale-build-id' }),
        url: 'https://example.com/__skew/ws',
      },
      send: vi.fn(),
    }

    handler.open(peer as never)

    expect(callHook).toHaveBeenCalledWith('skew:connection:open', expect.objectContaining({
      version: 'server-build-id',
    }))
  })
})
