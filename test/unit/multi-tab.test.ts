import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  channel: {
    name: '',
    data: { value: undefined as any },
    post: vi.fn(),
    close: vi.fn(),
    isSupported: { value: true },
  },
  watchers: [] as Array<{ source: any, callback: (value: any) => void }>,
  reload: vi.fn(),
}))

const hooks = new Map<string, Array<(...args: any[]) => any>>()
const callHook = vi.fn(async (name: string, ...args: any[]) => {
  for (const hook of hooks.get(name) || [])
    await hook(...args)
})
const hook = vi.fn((name: string, callback: (...args: any[]) => any) => {
  hooks.set(name, [...(hooks.get(name) || []), callback])
  return () => hooks.set(name, (hooks.get(name) || []).filter(item => item !== callback))
})
const nuxtApp = { hooks: { hook, callHook }, hook }

vi.mock('@vueuse/core', () => ({
  useBroadcastChannel: vi.fn(({ name }: { name: string }) => {
    mocks.channel.name = name
    return mocks.channel
  }),
  useDocumentVisibility: vi.fn(() => ({ value: 'visible' })),
  useIdle: vi.fn(() => ({ idle: { value: false } })),
}))

vi.mock('vue', () => ({
  ref: vi.fn((value: any) => ({ value })),
  watch: vi.fn((source: any, callback: (value: any) => void) => {
    mocks.watchers.push({ source, callback })
  }),
}))

vi.mock('nuxt/app', () => ({
  defineNuxtPlugin: vi.fn((plugin: any) => plugin),
  reloadNuxtApp: mocks.reload,
  useNuxtApp: vi.fn(() => nuxtApp),
  useRuntimeConfig: vi.fn(() => ({
    public: { skewProtection: { basePath: '/pro/__skew', multiTab: true, reloadStrategy: 'prompt' } },
  })),
}))

vi.mock('../../src/runtime/shared/logger', () => ({ logger: { debug: vi.fn() } }))

describe('multi-tab plugin', () => {
  beforeEach(() => {
    hooks.clear()
    hook.mockClear()
    callHook.mockClear()
    mocks.channel.name = ''
    mocks.channel.data.value = undefined
    mocks.channel.post.mockReset()
    mocks.channel.close.mockReset()
    mocks.watchers.length = 0
  })

  async function setup() {
    const { default: plugin } = await import('../../src/runtime/app/plugins/multi-tab.client')
    plugin.setup()
  }

  function receive(manifest: any) {
    const watcher = mocks.watchers.find(item => item.source === mocks.channel.data)
    watcher?.callback(manifest)
  }

  it('namespaces coordination by app mount', async () => {
    await setup()
    expect(mocks.channel.name).toBe('nuxt-skew-protection:/pro/__skew')
  })

  it('broadcasts the complete Nuxt manifest', async () => {
    await setup()
    const manifest = { id: 'v2', timestamp: 12345, meta: { test: true } }
    await callHook('app:manifest:update', manifest)
    expect(mocks.channel.post).toHaveBeenCalledWith(manifest)
  })

  it('forwards sibling updates without a broadcast loop', async () => {
    await setup()
    const manifest = { id: 'v2', timestamp: 12345 }
    receive(manifest)
    await vi.waitFor(() => expect(callHook).toHaveBeenCalledWith('app:manifest:update', manifest))
    expect(mocks.channel.post).not.toHaveBeenCalled()
  })

  it('ignores malformed sibling updates', async () => {
    await setup()
    receive({ timestamp: 12345 })
    expect(callHook).not.toHaveBeenCalled()
  })

  it('closes coordination when the app errors', async () => {
    await setup()
    await callHook('app:error', new Error('test'))
    expect(mocks.channel.close).toHaveBeenCalledOnce()
  })
})
