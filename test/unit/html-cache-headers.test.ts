import { describe, expect, it } from 'vitest'
import {
  htmlCacheHeaderValues,
  maxSafeHtmlCacheSeconds,
  resolveHtmlCacheHeadersOptions,
  resolveHtmlCachePolicy,
  resolveHtmlCacheRequestPolicy,
} from '../../src/runtime/server/utils/html-cache-policy'

const anonymousDocument = {
  method: 'GET',
  secFetchDest: 'document',
  accept: 'text/html,application/xhtml+xml',
  cookie: undefined,
}

const okResponse = { status: 200, hasSetCookie: false }
const enabled = resolveHtmlCacheHeadersOptions(true)

describe('htmlCacheHeaders options', () => {
  it('is off unless asked for', () => {
    expect(resolveHtmlCacheHeadersOptions(undefined)).toBe(false)
    expect(resolveHtmlCacheHeadersOptions(false)).toBe(false)
  })

  it('defaults to a window short enough for a busy deploy day', () => {
    expect(resolveHtmlCacheHeadersOptions(true)).toEqual({ maxAge: 60, staleWhileRevalidate: 60 })
  })

  it('keeps the default for whichever field is omitted', () => {
    expect(resolveHtmlCacheHeadersOptions({ maxAge: 300 }))
      .toEqual({ maxAge: 300, staleWhileRevalidate: 60 })
  })
})

describe('request-side policy', () => {
  it('accepts an anonymous document', () => {
    expect(resolveHtmlCacheRequestPolicy(enabled, anonymousDocument)).toEqual({ _tag: 'cacheable' })
  })

  it('never caches a request that carries a cookie', () => {
    expect(resolveHtmlCacheRequestPolicy(enabled, { ...anonymousDocument, cookie: 'session=abc' }))
      .toEqual({ _tag: 'skipped', reason: 'request-has-cookie' })
  })

  it('leaves sub-resource requests alone', () => {
    expect(resolveHtmlCacheRequestPolicy(enabled, { ...anonymousDocument, secFetchDest: 'script' }))
      .toEqual({ _tag: 'skipped', reason: 'not-document' })
  })

  it('treats a crawler that sends no sec-fetch-dest as a document', () => {
    expect(resolveHtmlCacheRequestPolicy(enabled, { ...anonymousDocument, secFetchDest: undefined }))
      .toEqual({ _tag: 'cacheable' })
  })

  it('ignores a client that sends neither signal', () => {
    expect(resolveHtmlCacheRequestPolicy(enabled, {
      ...anonymousDocument,
      secFetchDest: undefined,
      accept: '*/*',
    })).toEqual({ _tag: 'skipped', reason: 'not-document' })
  })

  it('only caches safe methods', () => {
    expect(resolveHtmlCacheRequestPolicy(enabled, { ...anonymousDocument, method: 'POST' }))
      .toEqual({ _tag: 'skipped', reason: 'not-cacheable-method' })
  })

  it('does nothing at all when the option is off', () => {
    expect(resolveHtmlCacheRequestPolicy(false, anonymousDocument))
      .toEqual({ _tag: 'skipped', reason: 'disabled' })
  })
})

describe('response-side policy', () => {
  it('caches a 200 that sets no cookie', () => {
    expect(resolveHtmlCachePolicy(enabled, anonymousDocument, okResponse)).toEqual({ _tag: 'cacheable' })
  })

  // A transient 500 during a deploy, held for the whole window, is a worse
  // outage than the one that produced it.
  it.each([404, 410, 500, 502, 503])('refuses to cache a %i', (status) => {
    expect(resolveHtmlCachePolicy(enabled, anonymousDocument, { ...okResponse, status }))
      .toEqual({ _tag: 'skipped', reason: 'not-ok-status' })
  })

  it('refuses a response that sets a cookie', () => {
    expect(resolveHtmlCachePolicy(enabled, anonymousDocument, { ...okResponse, hasSetCookie: true }))
      .toEqual({ _tag: 'skipped', reason: 'response-sets-cookie' })
  })

  it('cannot widen a request-side refusal', () => {
    expect(resolveHtmlCachePolicy(enabled, { ...anonymousDocument, cookie: 'a=1' }, okResponse))
      .toEqual({ _tag: 'skipped', reason: 'request-has-cookie' })
  })
})

describe('emitted headers', () => {
  it('keeps the document out of browser caches and in shared ones', () => {
    expect(htmlCacheHeaderValues({ maxAge: 60, staleWhileRevalidate: 60 })).toEqual({
      cacheControl: 'public, max-age=0, must-revalidate',
      cdnCacheControl: 'public, s-maxage=60, stale-while-revalidate=60',
    })
  })

  it('carries a custom window to the shared cache only', () => {
    expect(htmlCacheHeaderValues({ maxAge: 300, staleWhileRevalidate: 30 })).toMatchObject({
      cacheControl: 'public, max-age=0, must-revalidate',
      cdnCacheControl: 'public, s-maxage=300, stale-while-revalidate=30',
    })
  })
})

describe('retention ceiling', () => {
  it('converts retained days to seconds', () => {
    expect(maxSafeHtmlCacheSeconds(30)).toBe(2_592_000)
    expect(maxSafeHtmlCacheSeconds(1)).toBe(86_400)
  })

  it('never reports a negative or unbounded window', () => {
    expect(maxSafeHtmlCacheSeconds(0)).toBe(0)
    expect(maxSafeHtmlCacheSeconds(-5)).toBe(0)
    expect(maxSafeHtmlCacheSeconds(Number.NaN)).toBe(0)
    expect(maxSafeHtmlCacheSeconds(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('cookie interaction', () => {
  // Shared caches will not store a response carrying Set-Cookie, so the cookie
  // middleware has to stand down on exactly the requests this option claims.
  it('stands down on the same requests the cache claims', () => {
    expect(resolveHtmlCacheRequestPolicy(enabled, anonymousDocument)._tag).toBe('cacheable')
    expect(resolveHtmlCacheRequestPolicy(enabled, { ...anonymousDocument, cookie: '__nkpv=abc' })._tag).toBe('skipped')
  })

  it('leaves the cookie in place for every install that has not opted in', () => {
    expect(resolveHtmlCacheRequestPolicy(false, anonymousDocument)._tag).toBe('skipped')
  })
})
