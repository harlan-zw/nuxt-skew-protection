import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock BroadcastChannel
class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = []
  name: string
  onmessage: ((event: { data: any }) => void) | null = null
  postMessage = vi.fn((data: any) => {
    // BroadcastChannel delivers to all OTHER instances with the same name (not the sender)
    for (const instance of MockBroadcastChannel.instances) {
      if (instance !== this && instance.name === this.name && instance.onmessage) {
        instance.onmessage({ data })
      }
    }
  })

  close = vi.fn()

  constructor(name: string) {
    this.name = name
    MockBroadcastChannel.instances.push(this)
  }
}

vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)

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

function createMockNuxtApp() {
  return {
    hooks: {
      hook: mockHookFn,
      callHook: mockCallHook,
    },
    hook: mockHookFn,
  }
}

let mockNuxtApp = createMockNuxtApp()

vi.mock('nuxt/app', () => ({
  defineNuxtPlugin: vi.fn((opts: any) => opts),
  reloadNuxtApp: vi.fn(),
  useNuxtApp: vi.fn(() => mockNuxtApp),
  useRuntimeConfig: vi.fn(() => ({
    public: {
      skewProtection: {
        multiTab: true,
        reloadStrategy: 'prompt',
      },
    },
  })),
}))

vi.mock('../../src/runtime/shared/logger', () => ({
  logger: { debug: vi.fn() },
}))

describe('multi-tab plugin', () => {
  beforeEach(() => {
    mockHooks.clear()
    mockCallHook.mockClear()
    mockHookFn.mockClear()
    MockBroadcastChannel.instances = []
    mockNuxtApp = createMockNuxtApp()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function setupPlugin() {
    const mod = await import('../../src/runtime/app/plugins/multi-tab.client')
    const plugin = mod.default
    plugin.setup()
    return plugin
  }

  it('broadcasts version update to other tabs when detected locally', async () => {
    await setupPlugin()

    const channel = MockBroadcastChannel.instances[0]
    const manifest = { id: 'v2', timestamp: 12345 }

    // Simulate a locally detected manifest update
    await mockCallHook('app:manifest:update', manifest)

    expect(channel.postMessage).toHaveBeenCalledWith({
      type: 'version-update',
      id: 'v2',
      timestamp: 12345,
    })
  })

  it('triggers app:manifest:update when receiving broadcast from another tab', async () => {
    await setupPlugin()

    const channel = MockBroadcastChannel.instances[0]
    mockCallHook.mockClear()

    // Simulate receiving a message from another tab
    channel.onmessage!({ data: { type: 'version-update', id: 'v2', timestamp: 12345 } })

    expect(mockCallHook).toHaveBeenCalledWith('app:manifest:update', {
      type: 'version-update',
      id: 'v2',
      timestamp: 12345,
    })
  })

  it('does not re-broadcast updates received from BroadcastChannel (no ping-pong)', async () => {
    await setupPlugin()

    const channel = MockBroadcastChannel.instances[0]
    channel.postMessage.mockClear()

    // Simulate receiving a message from another tab
    // This calls app:manifest:update, which should NOT re-broadcast
    channel.onmessage!({ data: { type: 'version-update', id: 'v2', timestamp: 12345 } })

    expect(channel.postMessage).not.toHaveBeenCalled()
  })

  it('does not create infinite loop between two tabs', async () => {
    // Setup two "tabs" - each registers its own hooks and channel instance
    // Tab A
    await setupPlugin()
    const channelA = MockBroadcastChannel.instances[0]

    // Tab B - reset hooks and create a fresh nuxt app to simulate a second tab
    mockHooks.clear()
    mockHookFn.mockClear()
    mockNuxtApp = createMockNuxtApp()
    await setupPlugin()
    const channelB = MockBroadcastChannel.instances[1]

    // Reset call counts
    channelA.postMessage.mockClear()
    channelB.postMessage.mockClear()

    // Tab A broadcasts → Tab B receives → Tab B should NOT re-broadcast

    // Simulate Tab A broadcasting
    channelA.postMessage({ type: 'version-update', id: 'v2', timestamp: 12345 })

    // Tab B received it (via MockBroadcastChannel delivery) and called app:manifest:update
    // Check that Tab B did NOT re-broadcast
    expect(channelB.postMessage).not.toHaveBeenCalled()
  })

  it('still broadcasts subsequent local updates after receiving a channel message', async () => {
    await setupPlugin()

    const channel = MockBroadcastChannel.instances[0]

    // First: receive an update from another tab (should not re-broadcast)
    channel.onmessage!({ data: { type: 'version-update', id: 'v2', timestamp: 12345 } })
    channel.postMessage.mockClear()

    // Then: a local update happens (should broadcast)
    await mockCallHook('app:manifest:update', { id: 'v3', timestamp: 99999 })

    expect(channel.postMessage).toHaveBeenCalledWith({
      type: 'version-update',
      id: 'v3',
      timestamp: 99999,
    })
  })

  it('ignores broadcast messages without version-update type', async () => {
    await setupPlugin()

    const channel = MockBroadcastChannel.instances[0]
    mockCallHook.mockClear()

    channel.onmessage!({ data: { type: 'other-message', id: 'v2' } })
    expect(mockCallHook).not.toHaveBeenCalled()
  })

  it('ignores broadcast messages without id', async () => {
    await setupPlugin()

    const channel = MockBroadcastChannel.instances[0]
    mockCallHook.mockClear()

    channel.onmessage!({ data: { type: 'version-update' } })
    expect(mockCallHook).not.toHaveBeenCalled()
  })
})
