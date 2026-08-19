import { describe, expect, it } from 'vitest'
import {
  htmlCacheHeaderValues,
  matchRoutePattern,
  overlongRoutes,
  resolveHtmlCacheHeadersOptions,
  resolveHtmlCachePolicy,
  resolveHtmlCacheRequestPolicy,
  resolveRouteRule,
  skewCacheCeilingSeconds,
} from '../../src/runtime/server/utils/html-cache-policy'

function documentAt(path: string) {
  return {
    method: 'GET',
    path,
    secFetchDest: 'document',
    accept: 'text/html,application/xhtml+xml',
    cookie: undefined,
  }
}

const anonymousDocument = documentAt('/gh/nuxt/skills/deploy')
const okResponse = { status: 200, hasSetCookie: false, hasCacheControl: false }
const enabled = resolveHtmlCacheHeadersOptions(true)

// A registry page rebuilt on repo sync, a board rebuilt nightly, and an account
// page that must never be shared. One TTL cannot serve all three.
const perRoute = resolveHtmlCacheHeadersOptions({
  maxAge: 60,
  routes: {
    '/gh/**': { maxAge: 300 },
    '/skills/trending': { maxAge: 1800, staleWhileRevalidate: 3600 },
    '/@**': false,
  },
})

describe('htmlCacheHeaders options', () => {
  it('is off unless asked for', () => {
    expect(resolveHtmlCacheHeadersOptions(undefined)).toBe(false)
    expect(resolveHtmlCacheHeadersOptions(false)).toBe(false)
  })

  it('defaults to a window short enough for a busy deploy day', () => {
    expect(resolveHtmlCacheHeadersOptions(true)).toEqual({ maxAge: 60, staleWhileRevalidate: 60, routes: {} })
  })

  it('keeps the default for whichever field is omitted', () => {
    expect(resolveHtmlCacheHeadersOptions({ maxAge: 300 }))
      .toEqual({ maxAge: 300, staleWhileRevalidate: 60, routes: {} })
  })
})

describe('route patterns', () => {
  it('matches any depth under a double star', () => {
    expect(matchRoutePattern('/gh/**', '/gh/nuxt/skills/deploy').matched).toBe(true)
    expect(matchRoutePattern('/gh/**', '/gh').matched).toBe(true)
    expect(matchRoutePattern('/gh/**', '/ghost').matched).toBe(false)
  })

  it('matches one segment under a single star', () => {
    expect(matchRoutePattern('/gh/*', '/gh/nuxt').matched).toBe(true)
    expect(matchRoutePattern('/gh/*', '/gh/nuxt/skills').matched).toBe(false)
  })

  it('ignores query and hash', () => {
    expect(matchRoutePattern('/skills', '/skills?page=2').matched).toBe(true)
  })

  it('ranks exact above any pattern', () => {
    const exact = matchRoutePattern('/skills/trending', '/skills/trending')
    const deep = matchRoutePattern('/skills/**', '/skills/trending')

    expect(exact.matched && deep.matched).toBe(true)
    expect(exact.specificity).toBeGreaterThan(deep.specificity)
  })

  it('ranks a longer prefix above a shorter one', () => {
    const long = matchRoutePattern('/gh/nuxt/**', '/gh/nuxt/skills')
    const short = matchRoutePattern('/gh/**', '/gh/nuxt/skills')

    expect(long.specificity).toBeGreaterThan(short.specificity)
  })
})

describe('per-route rules', () => {
  it('gives a registry page its own longer window', () => {
    expect(resolveRouteRule(perRoute as never, '/gh/nuxt/skills/deploy'))
      .toEqual({ maxAge: 300, staleWhileRevalidate: 60 })
  })

  it('gives a nightly board a much longer one', () => {
    expect(resolveRouteRule(perRoute as never, '/skills/trending'))
      .toEqual({ maxAge: 1800, staleWhileRevalidate: 3600 })
  })

  it('opts a route out entirely', () => {
    expect(resolveRouteRule(perRoute as never, '/@harlan-zw')).toBe(false)
  })

  it('falls back to the defaults for an unlisted route', () => {
    expect(resolveRouteRule(perRoute as never, '/about'))
      .toEqual({ maxAge: 60, staleWhileRevalidate: 60 })
  })

  it('lets the most specific pattern win', () => {
    const nested = resolveHtmlCacheHeadersOptions({
      maxAge: 60,
      routes: { '/gh/**': { maxAge: 300 }, '/gh/nuxt/**': { maxAge: 30 } },
    })

    expect(resolveRouteRule(nested as never, '/gh/nuxt/skills')).toMatchObject({ maxAge: 30 })
    expect(resolveRouteRule(nested as never, '/gh/other/skills')).toMatchObject({ maxAge: 300 })
  })
})

describe('request-side policy', () => {
  it('accepts an anonymous document', () => {
    expect(resolveHtmlCacheRequestPolicy(enabled, anonymousDocument))
      .toEqual({ _tag: 'cacheable', rule: { maxAge: 60, staleWhileRevalidate: 60 } })
  })

  it('never caches a request that carries a cookie', () => {
    expect(resolveHtmlCacheRequestPolicy(enabled, { ...anonymousDocument, cookie: 'session=abc' }))
      .toEqual({ _tag: 'skipped', reason: 'request-has-cookie' })
  })

  it('reports an opted-out route by name', () => {
    expect(resolveHtmlCacheRequestPolicy(perRoute, documentAt('/@harlan-zw')))
      .toEqual({ _tag: 'skipped', reason: 'route-opted-out' })
  })

  it('leaves sub-resource requests alone', () => {
    expect(resolveHtmlCacheRequestPolicy(enabled, { ...anonymousDocument, secFetchDest: 'script' }))
      .toEqual({ _tag: 'skipped', reason: 'not-document' })
  })

  it('treats a crawler that sends no sec-fetch-dest as a document', () => {
    expect(resolveHtmlCacheRequestPolicy(enabled, { ...anonymousDocument, secFetchDest: undefined })._tag)
      .toBe('cacheable')
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
  it('caches a 200 that sets no cookie and no policy', () => {
    expect(resolveHtmlCachePolicy(enabled, anonymousDocument, okResponse)._tag).toBe('cacheable')
  })

  it('carries the matched route rule through', () => {
    expect(resolveHtmlCachePolicy(perRoute, anonymousDocument, okResponse))
      .toEqual({ _tag: 'cacheable', rule: { maxAge: 300, staleWhileRevalidate: 60 } })
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

  // An app with its own cache layer knows things this module cannot, so it wins
  // outright instead of being overwritten.
  it('stands down when the app already set a policy', () => {
    expect(resolveHtmlCachePolicy(enabled, anonymousDocument, { ...okResponse, hasCacheControl: true }))
      .toEqual({ _tag: 'skipped', reason: 'app-set-cache-control' })
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

  it('carries a route window to the shared cache only', () => {
    expect(htmlCacheHeaderValues({ maxAge: 300, staleWhileRevalidate: 30 })).toMatchObject({
      cacheControl: 'public, max-age=0, must-revalidate',
      cdnCacheControl: 'public, s-maxage=300, stale-while-revalidate=30',
    })
  })
})

describe('skew ceiling', () => {
  it('converts retained days to seconds', () => {
    expect(skewCacheCeilingSeconds(30)).toBe(2_592_000)
    expect(skewCacheCeilingSeconds(1)).toBe(86_400)
  })

  it('never reports a negative or unbounded window', () => {
    expect(skewCacheCeilingSeconds(0)).toBe(0)
    expect(skewCacheCeilingSeconds(-5)).toBe(0)
    expect(skewCacheCeilingSeconds(Number.NaN)).toBe(0)
    expect(skewCacheCeilingSeconds(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('names the route to change rather than the config in general', () => {
    const options = resolveHtmlCacheHeadersOptions({
      maxAge: 60,
      routes: { '/gh/**': { maxAge: 100_000 }, '/blog/**': { maxAge: 30 }, '/@**': false },
    })

    expect(overlongRoutes(options as never, skewCacheCeilingSeconds(1)))
      .toEqual([{ route: '/gh/**', seconds: 100_060 }])
  })

  it('reports nothing when every window fits', () => {
    expect(overlongRoutes(perRoute as never, skewCacheCeilingSeconds(30))).toEqual([])
  })
})

describe('cookie interaction', () => {
  // Shared caches will not store a response carrying Set-Cookie, so the cookie
  // middleware has to stand down on exactly the requests this option claims,
  // and only those. An opted-out route keeps its cookie.
  it('stands down only where the cache actually claims the document', () => {
    expect(resolveHtmlCacheRequestPolicy(perRoute, documentAt('/gh/nuxt/skills'))._tag).toBe('cacheable')
    expect(resolveHtmlCacheRequestPolicy(perRoute, documentAt('/@harlan-zw'))._tag).toBe('skipped')
    expect(resolveHtmlCacheRequestPolicy(perRoute, { ...anonymousDocument, cookie: '__nkpv=abc' })._tag).toBe('skipped')
  })

  it('leaves the cookie in place for every install that has not opted in', () => {
    expect(resolveHtmlCacheRequestPolicy(false, anonymousDocument)._tag).toBe('skipped')
  })
})

describe('identity routes', () => {
  // `/@handle` has no separator before the wildcard, and it is exactly the kind
  // of route that must never be shared between visitors.
  it('opts out an at-prefixed namespace', () => {
    expect(matchRoutePattern('/@**', '/@harlan-zw').matched).toBe(true)
    expect(matchRoutePattern('/@**', '/@harlan-zw/collections').matched).toBe(true)
    expect(matchRoutePattern('/@**', '/about').matched).toBe(false)
  })
})
