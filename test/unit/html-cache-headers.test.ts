import { describe, expect, it } from 'vitest'
import {
  overlongRouteRules,
  resolveHtmlCachePolicy,
  sharedCacheSeconds,
  skewCacheCeilingSeconds,
  withoutCookie,
} from '../../src/runtime/server/utils/html-cache-policy'

const anonymousDocument = {
  method: 'GET',
  secFetchDest: 'document',
  accept: 'text/html,application/xhtml+xml',
  cookie: undefined,
}

const cached = { status: 200, cacheControl: 'public, s-maxage=300' }

describe('reading the app\'s cache-control', () => {
  it('reads the directive addressed to shared caches', () => {
    expect(sharedCacheSeconds('public, s-maxage=300')).toBe(300)
  })

  it('prefers s-maxage over max-age', () => {
    expect(sharedCacheSeconds('public, max-age=60, s-maxage=300')).toBe(300)
  })

  it('falls back to max-age when there is no s-maxage', () => {
    expect(sharedCacheSeconds('public, max-age=120')).toBe(120)
  })

  it('counts the stale window, since a stale document is still served', () => {
    expect(sharedCacheSeconds('public, s-maxage=300, stale-while-revalidate=600')).toBe(900)
  })

  it.each([
    'private, no-store',
    'no-store',
    'private, max-age=60',
    'public, max-age=0, must-revalidate',
  ])('treats %s as a refusal', (value) => {
    expect(sharedCacheSeconds(value)).toBeNull()
  })

  it('returns null when the app said nothing', () => {
    expect(sharedCacheSeconds(undefined)).toBeNull()
    expect(sharedCacheSeconds('')).toBeNull()
  })

  it('is not fooled by a directive name appearing inside another', () => {
    expect(sharedCacheSeconds('public, stale-while-revalidate=600')).toBeNull()
  })
})

describe('which documents the cache was asked to keep', () => {
  it('claims an anonymous 200 the app marked cacheable', () => {
    expect(resolveHtmlCachePolicy(true, anonymousDocument, cached))
      .toEqual({ _tag: 'shared-cacheable', seconds: 300 })
  })

  // The whole point of the redesign: freshness comes from the app's own rules,
  // so a route the app said nothing about is left completely alone.
  it('leaves a document the app said nothing about alone', () => {
    expect(resolveHtmlCachePolicy(true, anonymousDocument, { status: 200, cacheControl: undefined }))
      .toEqual({ _tag: 'skipped', reason: 'no-shared-cache-directive' })
  })

  it('respects a route the app marked private', () => {
    expect(resolveHtmlCachePolicy(true, anonymousDocument, { status: 200, cacheControl: 'private, no-store' }))
      .toEqual({ _tag: 'skipped', reason: 'no-shared-cache-directive' })
  })

  it('never claims a request that carries a cookie', () => {
    expect(resolveHtmlCachePolicy(true, { ...anonymousDocument, cookie: 'session=abc' }, cached))
      .toEqual({ _tag: 'skipped', reason: 'request-has-cookie' })
  })

  // A transient 500 during a deploy, held for the whole window, is a worse
  // outage than the one that produced it.
  it.each([404, 410, 500, 502, 503])('refuses a %i', (status) => {
    expect(resolveHtmlCachePolicy(true, anonymousDocument, { ...cached, status }))
      .toEqual({ _tag: 'skipped', reason: 'not-ok-status' })
  })

  it('leaves sub-resource requests alone', () => {
    expect(resolveHtmlCachePolicy(true, { ...anonymousDocument, secFetchDest: 'script' }, cached))
      .toEqual({ _tag: 'skipped', reason: 'not-document' })
  })

  it('treats a crawler that sends no sec-fetch-dest as a document', () => {
    expect(resolveHtmlCachePolicy(true, { ...anonymousDocument, secFetchDest: undefined }, cached)._tag)
      .toBe('shared-cacheable')
  })

  it('only claims safe methods', () => {
    expect(resolveHtmlCachePolicy(true, { ...anonymousDocument, method: 'POST' }, cached))
      .toEqual({ _tag: 'skipped', reason: 'not-cacheable-method' })
  })

  it('does nothing at all when the option is off', () => {
    expect(resolveHtmlCachePolicy(false, anonymousDocument, cached))
      .toEqual({ _tag: 'skipped', reason: 'disabled' })
  })
})

describe('dropping the version cookie', () => {
  it('removes only the version cookie', () => {
    expect(withoutCookie(['__nkpv=abc; Path=/', 'consent=1; Path=/'], '__nkpv'))
      .toEqual(['consent=1; Path=/'])
  })

  it('handles a single string header', () => {
    expect(withoutCookie('__nkpv=abc; Path=/', '__nkpv')).toEqual([])
  })

  it('respects a derived cookie name', () => {
    expect(withoutCookie(['__nkpv_pro=abc'], '__nkpv_pro')).toEqual([])
    expect(withoutCookie(['__nkpv_pro=abc'], '__nkpv')).toEqual(['__nkpv_pro=abc'])
  })

  // An app cookie set during render is not ours to drop. The response simply
  // will not be stored, which is the correct outcome.
  it('leaves an app cookie in place', () => {
    expect(withoutCookie(['session=xyz; HttpOnly'], '__nkpv')).toEqual(['session=xyz; HttpOnly'])
  })

  it('copes with no cookie at all', () => {
    expect(withoutCookie(undefined, '__nkpv')).toEqual([])
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
})

describe('checking the app\'s own route rules', () => {
  const routeRules = {
    '/gh/**': { headers: { 'cache-control': 'public, s-maxage=300' } },
    '/archive/**': { headers: { 'Cache-Control': 'public, s-maxage=1000000' } },
    '/@**': { headers: { 'cache-control': 'private, no-store' } },
    '/api/**': { cors: true },
  }

  it('names the route rule the author wrote', () => {
    expect(overlongRouteRules(routeRules, skewCacheCeilingSeconds(1)))
      .toEqual([{ route: '/archive/**', seconds: 1_000_000 }])
  })

  it('matches the header name case-insensitively', () => {
    expect(overlongRouteRules({ '/x': { headers: { 'CACHE-CONTROL': 'public, s-maxage=999' } } }, 10))
      .toEqual([{ route: '/x', seconds: 999 }])
  })

  it('reports nothing when every window fits', () => {
    expect(overlongRouteRules(routeRules, skewCacheCeilingSeconds(30))).toEqual([])
  })

  it('copes with an app that has no route rules', () => {
    expect(overlongRouteRules({}, 60)).toEqual([])
  })
})
