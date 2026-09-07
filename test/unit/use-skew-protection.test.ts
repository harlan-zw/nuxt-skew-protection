import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockHooks = new Map<string, ((...args: any[]) => any)[]>()
const mockCallHook = vi.fn(async (name: string, ...args: any[]) => {
  const hooks = mockHooks.get(name) || []
  for (const hook of hooks) {
    await hook(...args)
  }
})
const mockHookFn = vi.fn((name: string, cb: (...args: any[]) => any) => {
  if (!mockHooks.has(name)) {
    mockHooks.set(name, [])
  }
  mockHooks.get(name)!.push(cb)
  return () => {
    const hooks = mockHooks.get(name) || []
    const idx = hooks.indexOf(cb)
    if (idx >= 0)
      hooks.splice(idx, 1)
  }
})

const mockRunWithContext = vi.fn((fn: () => any) => fn())
const mockOnUnmounted = vi.fn()

// One nuxtApp instance shared by every useSkewProtection() call, like a real app
const mockNuxtApp = {
  _skewVersionDetection: undefined as Record<string, unknown> | undefined,
  $skewConnection: {
    buildId: 'client-v1',
    cookie: { value: 'client-v1' },
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
  hooks: {
    hook: mockHookFn,
    callHook: mockCallHook,
  },
  hook: mockHookFn,
  runWithContext: mockRunWithContext,
}

vi.mock('nuxt/app', () => ({
  useNuxtApp: vi.fn(() => mockNuxtApp),
  useRuntimeConfig: vi.fn(() => ({
    app: { buildId: 'client-v1' },
    public: {
      skewProtection: {
        cookie: { name: '__nkpv', path: '/', sameSite: 'lax', maxAge: 604800 },
      },
    },
  })),
  useState: vi.fn((_key: string, init: () => any) => {
    const state = { value: init() }
    return state
  }),
}))

vi.mock('@vueuse/core', () => ({
  useOnline: vi.fn(() => ({ value: true })),
}))

vi.mock('vue', () => ({
  computed: vi.fn((fn: () => any) => ({ value: fn() })),
  onMounted: vi.fn((cb: () => void) => cb()),
  onUnmounted: mockOnUnmounted,
}))

vi.mock('#internal/nuxt/paths', () => ({
  buildAssetsURL: vi.fn((path: string) => `/_nuxt/${path}`),
}))

vi.mock('../../src/runtime/shared/logger', () => ({
  logger: { debug: vi.fn() },
}))

// We need to track $fetch calls
const mockFetch = vi.fn()
vi.stubGlobal('$fetch', mockFetch)

describe('useSkewProtection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockHooks.clear()
    mockCallHook.mockClear()
    mockHookFn.mockClear()
    mockOnUnmounted.mockClear()
    mockFetch.mockReset()
    mockNuxtApp._skewVersionDetection = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function setup() {
    const mod = await import('../../src/runtime/app/composables/useSkewProtection')
    const result = mod.useSkewProtection()

    // Collect registered hook handlers by name
    const getHookHandler = (name: string) => {
      const call = mockHookFn.mock.calls.find(([hookName]) => hookName === name)
      return call?.[1]
    }

    return { result, getHookHandler }
  }

  function simulateMessage(msg: Record<string, unknown>) {
    const hooks = mockHooks.get('skew:message') || []
    for (const hook of hooks) {
      hook(msg)
    }
  }

  describe('queue restart prevention on reconnection', () => {
    it('keeps detecting version updates after the component unmounts', async () => {
      mockFetch.mockResolvedValue({ id: 'server-v2', timestamp: Date.now() })
      await setup()

      // Component unmounts, e.g. on client-side navigation
      for (const [callback] of mockOnUnmounted.mock.calls)
        callback()

      // The connection stays open and reports a version mismatch after unmount
      simulateMessage({ type: 'version', version: 'server-v2' })

      await vi.advanceTimersByTimeAsync(0)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('registers one version listener per app so remounts do not stack listeners', async () => {
      mockFetch.mockResolvedValue({ id: 'server-v2', timestamp: Date.now() })
      await setup()
      await setup()

      for (const [callback] of mockOnUnmounted.mock.calls)
        callback()

      simulateMessage({ type: 'version', version: 'server-v2' })
      await vi.advanceTimersByTimeAsync(0)

      expect(mockHooks.get('skew:message')).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('does not restart the backoff queue when reconnection sends duplicate version mismatch', async () => {
      mockFetch.mockResolvedValue({ id: 'server-v2', timestamp: Date.now() })
      await setup()

      // First CONNECTED message: should start the queue
      simulateMessage({ type: 'connected', version: 'server-v2' })

      // Queue fires checkForUpdates at t=0, then clears itself
      await vi.advanceTimersByTimeAsync(0)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Simulate SSE reconnection sending another CONNECTED message with SAME version
      mockFetch.mockClear()
      simulateMessage({ type: 'connected', version: 'server-v2' })

      // Should be skipped entirely since we already processed this server version
      await vi.advanceTimersByTimeAsync(0)
      expect(mockFetch).toHaveBeenCalledTimes(0)
    })

    it('starts queue on first version mismatch', async () => {
      mockFetch.mockResolvedValue({ id: 'server-v2', timestamp: Date.now() })
      await setup()

      simulateMessage({ type: 'connected', version: 'server-v2' })

      await vi.advanceTimersByTimeAsync(0)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('ignores messages with matching client version', async () => {
      await setup()

      simulateMessage({ type: 'connected', version: 'client-v1' })

      await vi.advanceTimersByTimeAsync(0)
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('pending update replay', () => {
    it('replays a pending app-scoped update to consumers that mount after detection', async () => {
      const manifest = { id: 'server-v2', timestamp: Date.now() }
      mockFetch.mockResolvedValue(manifest)
      await setup()

      // The consumer unmounts before the update is detected
      for (const [callback] of mockOnUnmounted.mock.calls)
        callback()

      // Update detected while no consumer is mounted
      simulateMessage({ type: 'connected', version: 'server-v2' })
      await vi.advanceTimersByTimeAsync(0)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // A consumer mounts later: it must learn about the pending update
      mockFetch.mockClear()
      const seen: any[] = []
      const { result } = await setup()
      result.onAppOutdated(m => seen.push(m))

      expect(seen).toHaveLength(1)
      expect(seen[0]?.id).toBe('server-v2')
      expect(result.manifest.value?.id).toBe('server-v2')

      // The pending update is not re-detected: no extra fetch, no extra hook fire
      expect(mockFetch).toHaveBeenCalledTimes(0)
      const manifestUpdateCalls = mockCallHook.mock.calls.filter(
        ([name]) => name === 'app:manifest:update',
      )
      expect(manifestUpdateCalls).toHaveLength(1)
    })
  })

  describe('dismiss persistence', () => {
    it('does not replay an update the user dismissed until a new manifest id is detected', async () => {
      mockFetch.mockResolvedValue({ id: 'server-v2', timestamp: Date.now() })

      // First consumer sees the update and dismisses it
      const first = await setup()
      const firstSeen: any[] = []
      first.result.onAppOutdated(m => firstSeen.push(m))
      simulateMessage({ type: 'connected', version: 'server-v2' })
      await vi.advanceTimersByTimeAsync(0)
      expect(firstSeen).toHaveLength(1)
      first.result.dismissUpdate()

      // The consumer unmounts, a fresh consumer mounts on the same app:
      // the dismissed update must stay hidden
      for (const [callback] of mockOnUnmounted.mock.calls)
        callback()
      const second = await setup()
      const secondSeen: any[] = []
      second.result.onAppOutdated(m => secondSeen.push(m))
      expect(secondSeen).toHaveLength(0)

      // A new manifest id re-enables the update for fresh consumers
      mockFetch.mockResolvedValue({ id: 'server-v3', timestamp: Date.now() })
      for (const [callback] of mockOnUnmounted.mock.calls)
        callback()
      simulateMessage({ type: 'version', version: 'server-v3' })
      await vi.advanceTimersByTimeAsync(0)
      const third = await setup()
      const thirdSeen: any[] = []
      third.result.onAppOutdated(m => thirdSeen.push(m))
      expect(thirdSeen).toHaveLength(1)
      expect(thirdSeen[0]?.id).toBe('server-v3')
    })
  })

  describe('manifest update deduplication', () => {
    it('fires app:manifest:update only once for the same manifest version', async () => {
      const manifest = { id: 'server-v2', timestamp: Date.now(), skewProtection: { versions: {} } }
      mockFetch.mockResolvedValue(manifest)
      await setup()

      // Trigger version mismatch
      simulateMessage({ type: 'connected', version: 'server-v2' })

      // First tick (t=0): fetches manifest and fires hook
      await vi.advanceTimersByTimeAsync(0)
      const manifestUpdateCalls = mockCallHook.mock.calls.filter(
        ([name]) => name === 'app:manifest:update',
      )
      expect(manifestUpdateCalls).toHaveLength(1)

      // The queue should be cleared after first successful update,
      // so subsequent ticks should NOT fire
      mockCallHook.mockClear()
      await vi.advanceTimersByTimeAsync(5000)

      const laterCalls = mockCallHook.mock.calls.filter(
        ([name]) => name === 'app:manifest:update',
      )
      expect(laterCalls).toHaveLength(0)
    })

    it('clears the backoff queue after first successful manifest fetch', async () => {
      const manifest = { id: 'server-v2', timestamp: Date.now() }
      mockFetch.mockResolvedValue(manifest)
      await setup()

      simulateMessage({ type: 'connected', version: 'server-v2' })

      // First tick fires and clears queue
      await vi.advanceTimersByTimeAsync(0)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Advance past all remaining backoff delays (5s, 30s, 5min)
      mockFetch.mockClear()
      await vi.advanceTimersByTimeAsync(300_000)

      // No more fetches should have happened since queue was cleared
      expect(mockFetch).toHaveBeenCalledTimes(0)
    })

    it('allows a new queue start after a different version appears', async () => {
      const manifest1 = { id: 'server-v2', timestamp: Date.now() }
      mockFetch.mockResolvedValue(manifest1)
      await setup()

      // First version mismatch
      simulateMessage({ type: 'connected', version: 'server-v2' })
      await vi.advanceTimersByTimeAsync(0)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Queue cleared itself. Now a new VERSION message arrives (e.g., another deploy)
      const manifest2 = { id: 'server-v3', timestamp: Date.now() }
      mockFetch.mockResolvedValue(manifest2)
      mockFetch.mockClear()

      simulateMessage({ type: 'version', version: 'server-v3' })
      await vi.advanceTimersByTimeAsync(0)

      // Should have fetched again for the new version
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })
})
