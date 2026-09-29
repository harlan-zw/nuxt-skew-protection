// @vitest-environment happy-dom
import { reloadNuxtApp } from 'nuxt/app'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hooks = new Map<string, ((...args: any[]) => any)[]>()
const nuxtApp = {
  hooks: {
    hook: (name: string, cb: (...args: any[]) => any) => {
      hooks.set(name, [...(hooks.get(name) || []), cb])
      return () => {}
    },
    callHook: async (name: string, ...args: any[]) => {
      for (const cb of hooks.get(name) || [])
        await cb(...args)
    },
  },
}

vi.mock('nuxt/app', () => ({
  defineNuxtPlugin: (opts: any) => opts,
  reloadNuxtApp: vi.fn(),
  useNuxtApp: () => nuxtApp,
  useRuntimeConfig: () => ({
    public: { skewProtection: { basePath: '/__skew', multiTab: false, reloadStrategy: 'idle' } },
  }),
}))

vi.mock('../../src/runtime/shared/logger', () => ({
  logger: { debug: vi.fn() },
}))

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

async function outdateChunks() {
  const plugin = (await import('../../src/runtime/app/plugins/multi-tab.client')).default as any
  plugin.setup()
  await nuxtApp.hooks.callHook('skew:chunks-outdated', { deletedChunks: [], invalidatedModules: [], passedReleases: [] })
}

describe('reloadStrategy: idle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    hooks.clear()
    vi.mocked(reloadNuxtApp).mockClear()
    setHidden(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reloads a visible tab once the user stops interacting', async () => {
    await outdateChunks()
    expect(reloadNuxtApp).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(61_000)
    expect(reloadNuxtApp).toHaveBeenCalledWith({ force: true, persistState: true })
  })

  it('waits while the user is active', async () => {
    await outdateChunks()
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(20_000)
      window.dispatchEvent(new Event('mousemove'))
    }
    expect(reloadNuxtApp).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(61_000)
    expect(reloadNuxtApp).toHaveBeenCalledTimes(1)
  })

  it('reloads when the tab becomes hidden, without waiting for idle', async () => {
    await outdateChunks()
    window.dispatchEvent(new Event('mousemove'))
    setHidden(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(reloadNuxtApp).toHaveBeenCalledTimes(1)
  })
})
