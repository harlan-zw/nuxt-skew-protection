import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let cookieConfig: false | Record<string, unknown> = { name: '__nkpv', path: '/', sameSite: 'lax', maxAge: 604800 }

// Mock nuxt/app
vi.mock('nuxt/app', () => ({
  useNuxtApp: vi.fn(() => ({
    hook: vi.fn(),
  })),
  useRuntimeConfig: vi.fn(() => ({
    app: { buildId: 'test-build-id' },
    public: {
      skewProtection: {
        cookie: cookieConfig,
      },
    },
  })),
  useCookie: vi.fn(() => ({ value: null })),
}))

// Mock #imports
vi.mock('#imports', () => ({
  useBotDetection: vi.fn(() => ({ isBot: { value: false } })),
}))

// Mock logger
vi.mock('../../src/runtime/shared/logger', () => ({
  init: vi.fn(),
  logger: { debug: vi.fn() },
}))

describe('createSkewConnection', () => {
  beforeEach(() => {
    cookieConfig = { name: '__nkpv', path: '/', sameSite: 'lax', maxAge: 604800 }
    vi.clearAllMocks()
    vi.stubGlobal('window', { addEventListener: vi.fn() })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not call setup on creation (no auto-connect)', async () => {
    const { createSkewConnection } = await import('../../src/runtime/app/utils/create-skew-connection')
    const setupFn = vi.fn(() => vi.fn())

    createSkewConnection({
      name: 'Test',
      setup: setupFn,
    })

    // setup should NOT be called on creation
    expect(setupFn).not.toHaveBeenCalled()
  })

  it('calls setup only when connect() is called', async () => {
    const { createSkewConnection } = await import('../../src/runtime/app/utils/create-skew-connection')
    const cleanupFn = vi.fn()
    const setupFn = vi.fn(() => cleanupFn)

    const connection = createSkewConnection({
      name: 'Test',
      setup: setupFn,
    })

    expect(setupFn).not.toHaveBeenCalled()

    connection.connect()

    expect(setupFn).toHaveBeenCalledTimes(1)
  })

  it('connect() is idempotent - multiple calls only connect once', async () => {
    const { createSkewConnection } = await import('../../src/runtime/app/utils/create-skew-connection')
    const setupFn = vi.fn(() => vi.fn())

    const connection = createSkewConnection({
      name: 'Test',
      setup: setupFn,
    })

    connection.connect()
    connection.connect()
    connection.connect()

    expect(setupFn).toHaveBeenCalledTimes(1)
  })

  it('disconnect() calls cleanup function', async () => {
    const { createSkewConnection } = await import('../../src/runtime/app/utils/create-skew-connection')
    const cleanupFn = vi.fn()
    const setupFn = vi.fn(() => cleanupFn)

    const connection = createSkewConnection({
      name: 'Test',
      setup: setupFn,
    })

    connection.connect()
    expect(cleanupFn).not.toHaveBeenCalled()

    connection.disconnect()
    expect(cleanupFn).toHaveBeenCalledTimes(1)
  })

  it('can reconnect after disconnect', async () => {
    const { createSkewConnection } = await import('../../src/runtime/app/utils/create-skew-connection')
    const setupFn = vi.fn(() => vi.fn())

    const connection = createSkewConnection({
      name: 'Test',
      setup: setupFn,
    })

    connection.connect()
    expect(setupFn).toHaveBeenCalledTimes(1)

    connection.disconnect()

    connection.connect()
    expect(setupFn).toHaveBeenCalledTimes(2)
  })

  it('returns buildId from runtime config', async () => {
    const { createSkewConnection } = await import('../../src/runtime/app/utils/create-skew-connection')

    const connection = createSkewConnection({
      name: 'Test',
      setup: vi.fn(),
    })

    expect(connection.buildId).toBe('test-build-id')
  })

  it('does not create a version cookie when cookies are disabled', async () => {
    cookieConfig = false
    const { useCookie } = await import('nuxt/app')
    const { createSkewConnection } = await import('../../src/runtime/app/utils/create-skew-connection')

    const connection = createSkewConnection({
      name: 'Test',
      setup: vi.fn(),
    })

    expect(connection.cookie).toBeUndefined()
    expect(useCookie).not.toHaveBeenCalled()
  })
})
