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

const mockStates = new Map<string, { value: any }>()

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
    if (!mockStates.has(_key))
      mockStates.set(_key, { value: init() })
    return mockStates.get(_key)
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
    mockStates.clear()
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

  it('replays polling updates to a later consumer without another fetch', async () => {
    await setup()
    const manifest = { id: 'polling-v2', timestamp: Date.now() }
    await mockCallHook('app:manifest:update', manifest)
    const { result } = await setup()
    const callback = vi.fn()
    result.onAppOutdated(callback)
    expect(callback).toHaveBeenCalledWith(manifest)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('replays chunk invalidation to a later consumer', async () => {
    await setup()
    const payload = { deletedChunks: ['old.js'], invalidatedModules: ['old.js'], passedReleases: ['v2'] }
    await mockCallHook('skew:chunks-outdated', payload)
    const { result } = await setup()
    const callback = vi.fn()
    result.onCurrentChunksOutdated(callback)
    expect(callback).toHaveBeenCalledWith(payload)
  })

  it('shares an in-flight manual check across consumers', async () => {
    const first = await setup()
    const second = await setup()
    mockFetch.mockResolvedValue({ id: 'server-v2', timestamp: Date.now() })
    await Promise.all([first.result.checkForUpdates(), second.result.checkForUpdates()])
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('allows an update callback to check again without waiting on itself', async () => {
    const { result } = await setup()
    mockFetch.mockResolvedValue({ id: 'server-v2', timestamp: Date.now() })
    const completed = vi.fn()
    result.onAppOutdated(async () => {
      await result.checkForUpdates()
      completed()
    })
    const check = result.checkForUpdates()
    await vi.advanceTimersByTimeAsync(0)
    expect(completed).toHaveBeenCalledOnce()
    await check
  })

  describe('reduced broadcast manifest retention', () => {
    it('delivers the fetched full manifest to consumers that only saw the reduced broadcast', async () => {
      const timestamp = Date.now()
      const fullManifest = {
        id: 'server-v2',
        timestamp,
        skewProtection: { versions: { 'server-v2': { timestamp } } },
      }
      const { result } = await setup()

      // Another tab broadcasts the reduced payload; the retained hook stores it
      await mockCallHook('app:manifest:update', { type: 'version-update', id: 'server-v2', timestamp })

      // A consumer (e.g. the service worker plugin) mounts in this tab
      const seen: any[] = []
      result.onAppOutdated(m => seen.push(m))

      // This tab's own check fetches the full manifest with the same id
      mockFetch.mockResolvedValue(fullManifest)
      await result.checkForUpdates()

      // The consumer must receive the full manifest so chunk detection can run
      expect(seen.at(-1)?.skewProtection?.versions).toEqual(fullManifest.skewProtection.versions)
      expect(result.manifest.value).toEqual(fullManifest)
    })

    it('does not downgrade a fetched full manifest when a same-id broadcast arrives later', async () => {
      const timestamp = Date.now()
      const fullManifest = {
        id: 'server-v2',
        timestamp,
        skewProtection: { versions: { 'server-v2': { timestamp } } },
      }
      const { result } = await setup()

      // This tab's own check fetched and stored the full manifest first
      mockFetch.mockResolvedValue(fullManifest)
      await result.checkForUpdates()

      // A later cross-tab broadcast with the same id must not downgrade it
      await mockCallHook('app:manifest:update', { type: 'version-update', id: 'server-v2', timestamp })

      expect(result.manifest.value).toEqual(fullManifest)
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
