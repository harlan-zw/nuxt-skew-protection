import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const callHook = vi.fn()
const stream = {
  close: vi.fn(),
  onClosed: vi.fn(),
  push: vi.fn(),
  send: vi.fn(),
}

vi.mock('#nuxtseo/h3', () => ({
  createEventStream: vi.fn(() => stream),
  defineEventHandler: vi.fn((handler: unknown) => handler),
  getQuery: vi.fn(() => ({})),
  getRequestIP: vi.fn(),
}))

vi.mock('#nuxtseo/nitro', () => ({
  useNitroApp: vi.fn(() => ({ hooks: { callHook } })),
  useRuntimeConfig: vi.fn(() => ({ app: { buildId: 'server-build-id' } })),
}))

vi.mock('../../src/runtime/server/imports/cookie', () => ({
  getSkewProtectionCookie: vi.fn(),
}))

describe('sse connection cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not add SIGTERM listeners when connections open', async () => {
    const { default: handler } = await import('../../src/runtime/server/routes/__skew/sse')
    const processOn = vi.spyOn(process, 'on')

    await handler({ context: {} } as never)
    await handler({ context: {} } as never)

    expect(processOn).not.toHaveBeenCalledWith('SIGTERM', expect.any(Function))
  })
})
