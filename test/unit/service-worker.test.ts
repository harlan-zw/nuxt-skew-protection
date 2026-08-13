import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { beforeAll, describe, expect, it, vi } from 'vitest'

interface FetchEventLike {
  request: Request
  respondWith: (response: Promise<Response>) => void
  waitUntil: (promise: Promise<unknown>) => void
}

let serviceWorkerSource = ''

beforeAll(async () => {
  serviceWorkerSource = await readFile(new URL('../../sw/_nuxt-skew-sw.js', import.meta.url), 'utf8')
})

function loadFetchHandler(options: {
  fetch: typeof fetch
  scriptUrl: string
}) {
  const listeners = new Map<string, (event: FetchEventLike) => void>()
  const worker = {
    location: new URL(options.scriptUrl),
    clients: {
      claim: vi.fn(),
      matchAll: vi.fn().mockResolvedValue([]),
    },
    addEventListener: (type: string, listener: (event: FetchEventLike) => void) => {
      listeners.set(type, listener)
    },
  }

  runInNewContext(serviceWorkerSource, {
    Array,
    Headers,
    Promise,
    Request,
    Response,
    Set,
    URL,
    fetch: options.fetch,
    location: worker.location,
    self: worker,
  })

  return listeners.get('fetch')!
}

async function dispatchFetch(
  handler: (event: FetchEventLike) => void,
  request: Request,
) {
  let responsePromise: Promise<Response> | undefined
  handler({
    request,
    respondWith: (response) => { responsePromise = response },
    waitUntil: () => {},
  })
  return responsePromise && await responsePromise
}

describe('skew protection service worker', () => {
  it('keeps successful build assets on the free static path', async () => {
    const asset = new Response('chunk')
    const fetch = vi.fn().mockResolvedValue(asset)
    const handler = loadFetchHandler({
      fetch,
      scriptUrl: 'https://example.com/_nuxt-skew-sw.js?buildAssetsPath=%2F_nuxt%2F&recoveryPath=%2F__skew%2Fasset',
    })
    const request = new Request('https://example.com/_nuxt/entry.js')

    const response = await dispatchFetch(handler, request)

    expect(response).toBe(asset)
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(request)
  })

  it('uses the Worker recovery path only after a build asset 404', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('cached miss', { status: 404 }))
      .mockResolvedValueOnce(new Response('chunk', {
        headers: { 'content-type': 'text/javascript' },
      }))
    const handler = loadFetchHandler({
      fetch,
      scriptUrl: 'https://example.com/_nuxt-skew-sw.js?buildAssetsPath=%2Fpro%2F_nuxt%2F&recoveryPath=%2Fpro%2F__skew%2Fasset',
    })
    const request = new Request('https://example.com/pro/_nuxt/entry.js')

    const response = await dispatchFetch(handler, request)

    expect(await response?.text()).toBe('chunk')
    expect(response?.url).toBe('')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[0]![0]).toBe(request)
    const recoveryRequest = fetch.mock.calls[1]![0] as Request
    expect(recoveryRequest.url).toBe(
      'https://example.com/pro/__skew/asset?url=https%3A%2F%2Fexample.com%2Fpro%2F_nuxt%2Fentry.js',
    )
    expect(recoveryRequest.cache).toBe('no-cache')
  })

  it('does not intercept unrelated assets', async () => {
    const fetch = vi.fn()
    const handler = loadFetchHandler({
      fetch,
      scriptUrl: 'https://example.com/_nuxt-skew-sw.js?buildAssetsPath=%2F_nuxt%2F&recoveryPath=%2F__skew%2Fasset',
    })

    const response = await dispatchFetch(
      handler,
      new Request('https://example.com/favicon.ico'),
    )

    expect(response).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })
})
