import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  onAppOutdated: vi.fn(),
  callHook: vi.fn(),
}))

vi.mock('nuxt/app', () => ({ defineNuxtPlugin: (plugin: unknown) => plugin }))
vi.mock('../../src/runtime/app/composables/useSkewProtection', () => ({
  useSkewProtection: () => ({ clientVersion: 'v1', onAppOutdated: mocks.onAppOutdated }),
}))
vi.mock('../../src/runtime/app/composables/useRuntimeConfigSkewProtection', () => ({
  useRuntimeConfigSkewProtection: () => ({ assetRecovery: { _tag: 'none' } }),
}))
vi.mock('../../src/runtime/shared/logger', () => ({ logger: { debug: vi.fn() } }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('keeps loaded chunks available for later deployment checks', async () => {
  const modules = new Set(['http://localhost/_nuxt/old.js'])
  const listeners = new Set<(event: unknown) => void>()
  const worker = {
    postMessage(message: { type: string }) {
      if (message.type === 'RESET_MODULES')
        modules.clear()
      if (message.type === 'GET_MODULES') {
        queueMicrotask(() => {
          for (const listener of listeners)
            listener({ data: { type: 'MODULES_LIST', modules: [...modules] } })
        })
      }
    },
  }
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } })
  vi.stubGlobal('performance', { getEntriesByType: () => [] })
  vi.stubGlobal('navigator', {
    serviceWorker: {
      register: () => Promise.resolve({ active: worker }),
      addEventListener: (_name: string, listener: (event: unknown) => void) => listeners.add(listener),
      removeEventListener: (_name: string, listener: (event: unknown) => void) => listeners.delete(listener),
    },
  })
  const { default: plugin } = await import('../../src/runtime/app/plugins/sw-track-user-modules.client')
  plugin.setup({ hooks: { callHook: mocks.callHook } } as never)
  const update = mocks.onAppOutdated.mock.calls[0]![0]
  const versions = {
    v1: { timestamp: '2026-09-01', deletedChunks: [] },
    v2: { timestamp: '2026-09-02', deletedChunks: [] },
    v3: { timestamp: '2026-09-03', deletedChunks: ['_nuxt/old.js'] },
  }
  await update({ id: 'v2', skewProtection: { versions } })
  const next = update({ id: 'v3', skewProtection: { versions } })
  await vi.advanceTimersByTimeAsync(100)
  await next
  expect(mocks.callHook).toHaveBeenCalledWith('skew:chunks-outdated', {
    deletedChunks: ['_nuxt/old.js'],
    invalidatedModules: ['http://localhost/_nuxt/old.js'],
    passedReleases: ['v2', 'v3'],
  })
})
