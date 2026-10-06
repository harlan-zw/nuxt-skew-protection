import type { RequestEvent } from 'nuxt/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import handler from '../../src/runtime/server/routes/__skew-devtools/debug-production.get'

vi.mock('nuxt/server', () => ({
  defineEventHandler: (handler: (event: RequestEvent) => unknown) => handler,
  getQuery: (event: RequestEvent) => Object.fromEntries(new URL(event.req.url).searchParams),
}))

function requestEvent(): RequestEvent {
  const url = new URL('http://localhost/__skew-devtools/debug-production?url=https://example.com')
  return { req: new Request(url), url, context: {}, res: { headers: new Headers() } }
}

describe('production debug proxy response cleanup', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([404, 503])('cancels failed HTTP %i bodies before returning diagnostic errors', async (status) => {
    const cancel = vi.fn()
    const fetch = vi.fn(async () => new Response(new ReadableStream({ cancel }), { status }))
    vi.stubGlobal('fetch', fetch)

    const result = await handler(requestEvent())

    expect(result.errors).toEqual(expect.arrayContaining([`Health check failed: HTTP ${status} `, `Manifest fetch failed: HTTP ${status} `]))
    expect(cancel).toHaveBeenCalledTimes(status === 503 ? 4 : 2)
  })

  it('reports a body cancellation failure through the existing diagnostics', async () => {
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({
      cancel: () => Promise.reject(new Error('response cleanup failed')),
    }), { status: 404 }))

    const result = await handler(requestEvent())

    expect(result.errors).toEqual(expect.arrayContaining([
      'Health check failed: response cleanup failed',
      'Manifest fetch failed: response cleanup failed',
    ]))
  })
})
