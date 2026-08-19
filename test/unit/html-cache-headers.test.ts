import { describe, expect, it } from 'vitest'
import {
  cachingRouteRules,
  htmlCacheCapability,
  overlongRouteRules,
  readSetCookies,
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
  authorization: undefined,
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

  it('does not read a suffix of another directive name', () => {
    // `s-maxage` ends in `maxage`, not `max-age`, so this is really about the
    // leading boundary. A parser without one reads `x-max-age` as `max-age`.
    expect(sharedCacheSeconds('public, x-max-age=600')).toBeNull()
    expect(sharedCacheSeconds('public, no-s-maxage=600')).toBeNull()
    expect(sharedCacheSeconds('public, stale-while-revalidate=600')).toBeNull()
  })

  it('survives a header h3 handed back as an array', () => {
    expect(sharedCacheSeconds(['public', 's-maxage=300'])).toBe(300)
  })

  it('survives a non-string header without throwing', () => {
    expect(sharedCacheSeconds(0)).toBeNull()
    expect(sharedCacheSeconds(null)).toBeNull()
  })
})

describe('which documents the cache was asked to keep', () => {
  it('claims an anonymous 200 the app marked cacheable', () => {
    expect(resolveHtmlCachePolicy(anonymousDocument, cached))
      .toEqual({ _tag: 'shared-cacheable', seconds: 300 })
  })

  // The whole point of the redesign: freshness comes from the app's own rules,
  // so a route the app said nothing about is left completely alone.
  it('leaves a document the app said nothing about alone', () => {
    expect(resolveHtmlCachePolicy(anonymousDocument, { status: 200, cacheControl: undefined }))
      .toEqual({ _tag: 'skipped', reason: 'no-shared-cache-directive' })
  })

  it('respects a route the app marked private', () => {
    expect(resolveHtmlCachePolicy(anonymousDocument, { status: 200, cacheControl: 'private, no-store' }))
      .toEqual({ _tag: 'skipped', reason: 'no-shared-cache-directive' })
  })

  it('never claims a request that carries a cookie', () => {
    expect(resolveHtmlCachePolicy({ ...anonymousDocument, cookie: 'session=abc' }, cached))
      .toEqual({ _tag: 'skipped', reason: 'request-has-cookie' })
  })

  // A transient 500 during a deploy, held for the whole window, is a worse
  // outage than the one that produced it.
  it.each([404, 410, 500, 502, 503])('refuses a %i', (status) => {
    expect(resolveHtmlCachePolicy(anonymousDocument, { ...cached, status }))
      .toEqual({ _tag: 'skipped', reason: 'not-ok-status' })
  })

  it('leaves sub-resource requests alone', () => {
    expect(resolveHtmlCachePolicy({ ...anonymousDocument, secFetchDest: 'script' }, cached))
      .toEqual({ _tag: 'skipped', reason: 'not-document' })
  })

  it('treats a crawler that sends no sec-fetch-dest as a document', () => {
    expect(resolveHtmlCachePolicy({ ...anonymousDocument, secFetchDest: undefined }, cached)._tag)
      .toBe('shared-cacheable')
  })

  it('only claims safe methods', () => {
    expect(resolveHtmlCachePolicy({ ...anonymousDocument, method: 'POST' }, cached))
      .toEqual({ _tag: 'skipped', reason: 'not-cacheable-method' })
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
      .toEqual([{ route: '/archive/**', seconds: 1_000_000, source: 'cache-control' }])
  })

  it('matches the header name case-insensitively', () => {
    expect(overlongRouteRules({ '/x': { headers: { 'CACHE-CONTROL': 'public, s-maxage=999' } } }, 10))
      .toEqual([{ route: '/x', seconds: 999, source: 'cache-control' }])
  })

  it('reports nothing when every window fits', () => {
    expect(overlongRouteRules(routeRules, skewCacheCeilingSeconds(30))).toEqual([])
  })

  it('copes with an app that has no route rules', () => {
    expect(overlongRouteRules({}, 60)).toEqual([])
  })

  // This list is what decides whether the build says anything at all. An app
  // that caches nothing must produce an empty one, or every user who never
  // asked for HTML caching gets warned about it.
  it('lists every rule that asks a shared cache to keep a document', () => {
    expect(cachingRouteRules(routeRules)).toEqual([
      { route: '/gh/**', seconds: 300, source: 'cache-control' },
      { route: '/archive/**', seconds: 1_000_000, source: 'cache-control' },
    ])
  })

  it('lists nothing for an app that declares no caching', () => {
    expect(cachingRouteRules({ '/api/**': { cors: true }, '/@**': { headers: { 'cache-control': 'private, no-store' } } }))
      .toEqual([])
  })
})

describe('what retention can promise', () => {
  const stored = { retentionDays: 30, maxNumberOfVersions: 10, assetRecovery: true }

  // Was Cloudflare-only until #48 landed. Retained chunks are now restored
  // before nitro seals its public asset manifest, so they resolve on every
  // preset, and gating the promise on Cloudflare under-promised everywhere else.
  it('promises retention whenever assets were actually kept', () => {
    expect(htmlCacheCapability(stored)).toMatchObject({ v: 1, assetRecovery: true })
  })

  it('promises nothing when no assets were kept', () => {
    expect(htmlCacheCapability({ ...stored, assetRecovery: false })).toBeNull()
  })

  // Rank binds before time for anyone deploying often, so the ceiling is the
  // smaller of the two rather than the configured retention window.
  it('takes the tighter of the time and rank bounds', () => {
    expect(htmlCacheCapability({ ...stored, maxNumberOfVersions: 2 })?.documentTtlCeilingSeconds)
      .toBe(2 * 60 * 60)
  })
})

describe('credentials other than cookies', () => {
  // Before this feature the version cookie made every document unstorable, so
  // a blanket route rule over an authenticated page was inert. Removing the
  // cookie removes that accident too, and a bearer-token document published to
  // a shared cache is served to everyone.
  it('refuses a bearer-authenticated document', () => {
    expect(resolveHtmlCachePolicy({ ...anonymousDocument, authorization: 'Bearer abc' }, cached))
      .toEqual({ _tag: 'skipped', reason: 'request-is-authenticated' })
  })

  it('refuses a proxy-authenticated document', () => {
    const request = { ...anonymousDocument, authorization: 'Basic abc' }

    expect(resolveHtmlCachePolicy(request, cached)._tag).toBe('skipped')
  })
})

describe('reading Set-Cookie across h3 majors', () => {
  const h3v1 = {}
  const h3v2 = (cookies: string[]) => ({
    res: { headers: { getSetCookie: () => cookies } },
  })

  // h3 v2 stores response headers in a `Headers`, and `get('set-cookie')`
  // joins every cookie with ", ". Filtering that string treats two cookies as
  // one value and deletes the app's.
  it('separates cookies on h3 v2 instead of taking the joined string', () => {
    const joined = '__nkpv=abc; Path=/, session=xyz; HttpOnly'

    expect(readSetCookies(h3v2(['__nkpv=abc; Path=/', 'session=xyz; HttpOnly']), joined))
      .toEqual(['__nkpv=abc; Path=/', 'session=xyz; HttpOnly'])
  })

  it('keeps the app\'s cookie when ours is filtered out on h3 v2', () => {
    const cookies = readSetCookies(h3v2(['__nkpv=abc; Path=/', 'session=xyz; HttpOnly']), undefined)

    expect(withoutCookie(cookies, '__nkpv')).toEqual(['session=xyz; HttpOnly'])
  })

  it('reads the array h3 v1 already provides', () => {
    expect(readSetCookies(h3v1, ['__nkpv=abc', 'session=xyz']))
      .toEqual(['__nkpv=abc', 'session=xyz'])
  })

  it('wraps a lone string header', () => {
    expect(readSetCookies(h3v1, '__nkpv=abc')).toEqual(['__nkpv=abc'])
  })

  it('reports no cookies rather than one empty one', () => {
    expect(readSetCookies(h3v1, undefined)).toEqual([])
    expect(readSetCookies(h3v1, '')).toEqual([])
  })
})

describe('route rules that do not spell it as a header', () => {
  it('sees a swr rule, which headers-only scanning missed entirely', () => {
    expect(overlongRouteRules({ '/blog/**': { swr: 31_536_000 } }, skewCacheCeilingSeconds(30)))
      .toEqual([{ route: '/blog/**', seconds: 31_536_000, source: 'swr' }])
  })

  it('sees an isr rule', () => {
    expect(overlongRouteRules({ '/docs/**': { isr: 2_000_000 } }, skewCacheCeilingSeconds(1)))
      .toEqual([{ route: '/docs/**', seconds: 2_000_000, source: 'isr' }])
  })

  it('treats an unbounded swr as unbounded rather than skipping it', () => {
    expect(overlongRouteRules({ '/x': { swr: true } }, skewCacheCeilingSeconds(30)))
      .toMatchObject([{ route: '/x', source: 'swr' }])
  })

  it('sees a normalised cache rule', () => {
    expect(overlongRouteRules({ '/x': { cache: { maxAge: 60, staleMaxAge: 31_536_000 } } }, skewCacheCeilingSeconds(1)))
      .toEqual([{ route: '/x', seconds: 31_536_060, source: 'cache' }])
  })

  it('prefers an explicit header over the shorthand', () => {
    const rules = { '/x': { swr: 31_536_000, headers: { 'cache-control': 'public, s-maxage=60' } } }

    expect(overlongRouteRules(rules, skewCacheCeilingSeconds(30))).toEqual([])
  })

  it('ignores a rule that says nothing about caching', () => {
    expect(overlongRouteRules({ '/api/**': { cors: true } } as never, 60)).toEqual([])
  })
})

describe('what this module promises other modules', () => {
  const full = { retentionDays: 30, maxNumberOfVersions: 10, assetRecovery: true }

  // `@harlan-zw/nuxt-cloudflare` forces `private, no-store` on HTML because a
  // cached document can name chunks a later deploy deleted. This is how the
  // answer to that is stated in a form it can act on.
  it('publishes a bound, not an instruction', () => {
    expect(htmlCacheCapability(full)).toEqual({
      v: 1,
      by: 'nuxt-skew-protection',
      documentTtlCeilingSeconds: 36_000,
      basis: 'retention-days',
      assetRecovery: true,
    })
  })

  // `maxNumberOfVersions` prunes by rank, so ten versions at one deploy an hour
  // is ten hours, not the thirty days `retentionDays` claims. Whichever binds
  // first ends the guarantee.
  it('takes the rank bound when it is tighter than the time bound', () => {
    expect(htmlCacheCapability({ ...full, maxNumberOfVersions: 3 }))
      .toMatchObject({ documentTtlCeilingSeconds: 10_800 })
  })

  it('takes the time bound when that is tighter', () => {
    expect(htmlCacheCapability({ ...full, retentionDays: 0.1, maxNumberOfVersions: 100 }))
      .toMatchObject({ documentTtlCeilingSeconds: 8_640 })
  })

  // Retaining builds is what turns a stale document from a ChunkLoadError into
  // a slow page. Promising a window with nothing stored behind it is worse than
  // promising nothing.
  it('promises nothing when old builds are not served', () => {
    expect(htmlCacheCapability({ ...full, assetRecovery: false })).toBeNull()
  })

  it('promises nothing when retention is zero', () => {
    expect(htmlCacheCapability({ ...full, retentionDays: 0, maxNumberOfVersions: 0 })).toBeNull()
  })
})
