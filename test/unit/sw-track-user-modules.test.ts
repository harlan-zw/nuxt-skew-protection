import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  onAppOutdated: vi.fn(),
  callHook: vi.fn(),
  register: vi.fn(),
  runtimeConfig: { app: { baseURL: '/' } },
}))

vi.mock('nuxt/app', () => ({
  defineNuxtPlugin: (plugin: unknown) => plugin,
  useRuntimeConfig: () => mocks.runtimeConfig,
}))
vi.mock('../../src/runtime/app/composables/useSkewProtection', () => ({
  useSkewProtection: () => ({ clientVersion: 'v1', onAppOutdated: mocks.onAppOutdated }),
}))
vi.mock('../../src/runtime/app/composables/useRuntimeConfigSkewProtection', () => ({
  useRuntimeConfigSkewProtection: () => ({ assetRecovery: { _tag: 'none' } }),
}))
vi.mock('#internal/nuxt/paths', () => ({ buildAssetsURL: (path: string) => `/_nuxt/${path}` }))
vi.mock('../../src/runtime/shared/logger', () => ({ logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.runtimeConfig.app.baseURL = '/'
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function setupWorker(existingScriptURL?: string | Error) {
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
      getRegistration: () => existingScriptURL instanceof Error
        ? Promise.reject(existingScriptURL)
        : Promise.resolve(existingScriptURL ? { active: { scriptURL: existingScriptURL } } : undefined),
      register: mocks.register.mockResolvedValue({ active: worker }),
      addEventListener: (_name: string, listener: (event: unknown) => void) => listeners.add(listener),
      removeEventListener: (_name: string, listener: (event: unknown) => void) => listeners.delete(listener),
    },
  })
  const { default: plugin } = await import('../../src/runtime/app/plugins/sw-track-user-modules.client')
  await plugin.setup({ hooks: { callHook: mocks.callHook } } as never)
  return mocks.onAppOutdated.mock.calls[0]?.[0] as (manifest: unknown) => Promise<void>
}

it('preserves an existing PWA service worker', async () => {
  await setupWorker('http://localhost/sw.js')
  expect(mocks.register).not.toHaveBeenCalled()
})

it('skips registration when browser permissions block inspection', async () => {
  await setupWorker(new Error('Service worker access denied'))
  expect(mocks.register).not.toHaveBeenCalled()
})

it('registers inside the app base URL', async () => {
  mocks.runtimeConfig.app.baseURL = '/app/'
  await setupWorker()
  expect(mocks.register).toHaveBeenCalledWith('http://localhost/app/_nuxt-skew-sw.js')
})

it('can update its own service worker', async () => {
  await setupWorker('http://localhost/_nuxt-skew-sw.js')
  expect(mocks.register).toHaveBeenCalledWith('http://localhost/_nuxt-skew-sw.js')
})

it('keeps loaded chunks available for later deployment checks', async () => {
  const update = await setupWorker()
  const fetchSkew = vi.fn((url: string) => Promise.resolve(
    url === '/_nuxt/builds/skew/v3.json' ? { deletedChunks: { v3: ['_nuxt/old.js'] } } : { deletedChunks: {} },
  ))
  vi.stubGlobal('$fetch', fetchSkew)
  const versions = {
    v1: { timestamp: '2026-09-01' },
    v2: { timestamp: '2026-09-02' },
    v3: { timestamp: '2026-09-03' },
  }
  await update({ id: 'v2', skewProtection: { versions } })
  const next = update({ id: 'v3', skewProtection: { versions } })
  await vi.advanceTimersByTimeAsync(100)
  await next
  expect(fetchSkew).toHaveBeenLastCalledWith('/_nuxt/builds/skew/v3.json')
  expect(mocks.callHook).toHaveBeenCalledWith('skew:chunks-outdated', {
    deletedChunks: ['_nuxt/old.js'],
    invalidatedModules: ['http://localhost/_nuxt/old.js'],
    passedReleases: ['v2', 'v3'],
  })
})

it('retries a skew file that appears after the manifest', async () => {
  const update = await setupWorker()
  const fetchSkew = vi.fn()
    .mockRejectedValueOnce(new Error('skew file not deployed yet'))
    .mockResolvedValue({ deletedChunks: { v2: ['_nuxt/old.js'] } })
  vi.stubGlobal('$fetch', fetchSkew)

  await update({
    id: 'v2',
    skewProtection: {
      versions: {
        v1: { timestamp: '2026-09-01' },
        v2: { timestamp: '2026-09-02' },
      },
    },
  })
  expect(mocks.callHook).not.toHaveBeenCalledWith('skew:chunks-outdated', expect.anything())

  await vi.advanceTimersByTimeAsync(5_100)
  expect(fetchSkew).toHaveBeenCalledTimes(2)
  expect(mocks.callHook).toHaveBeenCalledWith('skew:chunks-outdated', {
    deletedChunks: ['_nuxt/old.js'],
    invalidatedModules: ['http://localhost/_nuxt/old.js'],
    passedReleases: ['v2'],
  })

  await vi.advanceTimersByTimeAsync(300_000)
  expect(mocks.callHook).toHaveBeenCalledTimes(1)
})

it('retries when a missing skew file returns an HTML fallback', async () => {
  const update = await setupWorker()
  const fetchSkew = vi.fn()
    .mockResolvedValueOnce('<html>app shell</html>')
    .mockResolvedValue({ deletedChunks: { v2: ['_nuxt/old.js'] } })
  vi.stubGlobal('$fetch', fetchSkew)

  await update({
    id: 'v2',
    skewProtection: {
      versions: {
        v1: { timestamp: '2026-09-01' },
        v2: { timestamp: '2026-09-02' },
      },
    },
  })
  await vi.advanceTimersByTimeAsync(5_100)

  expect(fetchSkew).toHaveBeenCalledTimes(2)
  expect(mocks.callHook).toHaveBeenCalledOnce()
  expect(mocks.callHook).toHaveBeenCalledWith('skew:chunks-outdated', {
    deletedChunks: ['_nuxt/old.js'],
    invalidatedModules: ['http://localhost/_nuxt/old.js'],
    passedReleases: ['v2'],
  })
})

it('stops an older skew retry after a newer build is checked', async () => {
  const update = await setupWorker()
  const fetchSkew = vi.fn((url: string) => {
    if (url.endsWith('/v2.json'))
      return Promise.reject(new Error('not deployed yet'))
    return Promise.resolve({ deletedChunks: { v3: ['_nuxt/old.js'] } })
  })
  vi.stubGlobal('$fetch', fetchSkew)
  const versions = {
    v1: { timestamp: '2026-09-01' },
    v2: { timestamp: '2026-09-02' },
    v3: { timestamp: '2026-09-03' },
  }

  await update({ id: 'v2', skewProtection: { versions } })
  const newerCheck = update({ id: 'v3', skewProtection: { versions } })
  await vi.advanceTimersByTimeAsync(100)
  await newerCheck
  await vi.advanceTimersByTimeAsync(5_000)

  expect(fetchSkew).toHaveBeenCalledTimes(2)
  expect(mocks.callHook).toHaveBeenCalledOnce()
})

it('checks inline deleted chunks from an older deployment', async () => {
  const update = await setupWorker()
  const fetchSkew = vi.fn()
  vi.stubGlobal('$fetch', fetchSkew)
  const manifest = {
    id: 'v2',
    skewProtection: {
      versions: {
        v1: { timestamp: '2026-09-01', deletedChunks: [] },
        v2: { timestamp: '2026-09-02', deletedChunks: ['_nuxt/old.js'] },
      },
    },
  }

  const check = update(manifest)
  await vi.advanceTimersByTimeAsync(100)
  await check
  await update(manifest)

  expect(fetchSkew).not.toHaveBeenCalled()
  expect(mocks.callHook).toHaveBeenCalledOnce()
  expect(mocks.callHook).toHaveBeenCalledWith('skew:chunks-outdated', {
    deletedChunks: ['_nuxt/old.js'],
    invalidatedModules: ['http://localhost/_nuxt/old.js'],
    passedReleases: ['v2'],
  })
})
