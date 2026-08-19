/**
 * Makes an app's own HTML caching survive skew protection.
 *
 * Freshness is not this module's decision. How often a page changes is the
 * app's knowledge, it differs per route, and Nuxt already has a way to say it:
 *
 * ```ts
 * routeRules: {
 *   '/gh/**': { headers: { 'cache-control': 'public, s-maxage=300' } },
 *   '/blog/**': { headers: { 'cache-control': 'public, s-maxage=3600' } },
 * }
 * ```
 *
 * What this module knows is different and singular: how long a document may
 * outlive the build that rendered it, which falls out of `retentionDays` and
 * `maxNumberOfVersions`. So it contributes two things and invents no config of
 * its own.
 *
 * First, it gets out of the way. `set-skew-protection-cookie` puts `__nkpv` on
 * every document, and shared caches will not store a response carrying
 * Set-Cookie, so the rule above silently does nothing today. The version cookie
 * is dropped from exactly the documents a shared cache was asked to keep.
 *
 * Second, it states the bound. Any route whose declared window exceeds what
 * retention can promise is named at build time, because a document that
 * outlives its chunks is the failure this module exists to prevent.
 *
 * There is no option to turn this on. Writing the route rule is the opt-in, and
 * a flag would only mean the rule keeps silently doing nothing until the author
 * finds a second thing to write. What the response asks for is the whole input,
 * so a route that says nothing about caching is never touched.
 */

export type HtmlCacheSkipReason
  = | 'not-cacheable-method'
    | 'not-document'
    | 'request-has-cookie'
    | 'request-is-authenticated'
    | 'not-ok-status'
    | 'no-shared-cache-directive'

export type HtmlCacheDecision
  = | { _tag: 'shared-cacheable', seconds: number }
    | { _tag: 'skipped', reason: HtmlCacheSkipReason }

export interface HtmlCacheRequest {
  method: string
  secFetchDest: string | undefined
  accept: string | undefined
  cookie: string | undefined
  /** Any credential that personalises a document without being a cookie. */
  authorization: string | undefined
}

function isDocumentRequest(request: HtmlCacheRequest): boolean {
  // `sec-fetch-dest` is the reliable signal and every current browser sends it.
  // Fall back to `accept` for clients that do not, which is most crawlers, and
  // crawlers are the traffic a shared cache helps most.
  if (request.secFetchDest)
    return request.secFetchDest === 'document'
  return request.accept?.includes('text/html') === true
}

function directive(value: string, name: string): number | undefined {
  const match = value.match(new RegExp(`(?:^|[,\\s])${name}=(\\d+)`, 'i'))
  return match ? Number(match[1]) : undefined
}

/**
 * How long a shared cache may hold this response, in seconds.
 *
 * Returns null when the app did not ask for shared caching. `private` and
 * `no-store` are refusals. `s-maxage` beats `max-age` because it is the one
 * addressed to shared caches, which is what a stale document is served from.
 */
export function sharedCacheSeconds(cacheControl: unknown): number | null {
  // h3 v1 types this as `number | string | string[] | undefined`, and app code
  // calling `appendResponseHeader` twice really does produce an array. Coercing
  // here rather than asserting a string keeps a duplicated header from throwing
  // inside a hook whose rejection Nitro swallows, which would leave the feature
  // silently dead rather than loudly wrong.
  const raw = Array.isArray(cacheControl) ? cacheControl.join(', ') : cacheControl
  if (typeof raw !== 'string' || !raw)
    return null
  const value = raw.toLowerCase()
  if (value.includes('no-store') || value.includes('private'))
    return null

  const shared = directive(value, 's-maxage') ?? directive(value, 'max-age')
  if (shared === undefined || shared <= 0)
    return null

  return shared + (directive(value, 'stale-while-revalidate') ?? 0)
}

/**
 * Whether a shared-cache window came only from `max-age`.
 *
 * `s-maxage` is read by shared caches and ignored by browsers, so writing it is
 * proof the author meant a CDN. `max-age` is also how you say "browser, hold
 * this", and nothing in the header separates that intent from CDN intent. The
 * response is storable by a shared cache either way, so this does not change
 * what the policy decides. It exists so the build can name the routes where the
 * author may not have meant it.
 */
export function sharedWindowFromMaxAgeAlone(cacheControl: unknown): boolean {
  if (sharedCacheSeconds(cacheControl) === null)
    return false
  const raw = Array.isArray(cacheControl) ? cacheControl.join(', ') : cacheControl
  if (typeof raw !== 'string')
    return false
  return directive(raw.toLowerCase(), 's-maxage') === undefined
}

/**
 * Whether this response is one a shared cache was asked to keep.
 *
 * The app's `cache-control` is the whole input. However it got there, route
 * rules, a nitro plugin, or a handler, the answer is the same, so an app with
 * its own cache layer needs no special case.
 */
export function resolveHtmlCachePolicy(
  request: HtmlCacheRequest,
  response: { status: number, cacheControl: unknown },
): HtmlCacheDecision {
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return { _tag: 'skipped', reason: 'not-cacheable-method' }

  if (!isDocumentRequest(request))
    return { _tag: 'skipped', reason: 'not-document' }

  // A request carrying any cookie may render a personalised document, and a
  // shared cache keys on the URL alone. Leave the version cookie on it, so the
  // response stays unstorable.
  //
  // This bounds what goes in, not what comes out. A cache that already holds
  // the anonymous document will serve it to a cookied request without ever
  // reaching this code, because shared caches do not vary on Cookie. Say
  // `private` in the route rule for any page whose output depends on who asked.
  if (request.cookie)
    return { _tag: 'skipped', reason: 'request-has-cookie' }

  // A cookie is not the only way a document gets personalised. Before this
  // module the version cookie made every document unstorable, so a blanket
  // `cache-control` route rule over an authenticated page was inert. Removing
  // the cookie removes that accident, and a token-authenticated document would
  // then be published to a shared cache and served to everyone. The guard has
  // to cover every credential the request can carry, not just the one this
  // module happens to set.
  if (request.authorization)
    return { _tag: 'skipped', reason: 'request-is-authenticated' }

  // Caching an error page is worse than not caching at all: a transient 500
  // during a deploy would be served to everyone for the whole window.
  if (response.status !== 200)
    return { _tag: 'skipped', reason: 'not-ok-status' }

  const seconds = sharedCacheSeconds(response.cacheControl)
  if (seconds === null)
    return { _tag: 'skipped', reason: 'no-shared-cache-directive' }

  return { _tag: 'shared-cacheable', seconds }
}

/**
 * The same Set-Cookie header with one cookie removed.
 *
 * Only the version cookie goes. An app cookie set during render is not ours to
 * drop, and a response still carrying one simply will not be stored, which is
 * the correct outcome.
 */
export function withoutCookie(
  setCookie: string | string[] | undefined,
  name: string,
): string[] {
  if (!setCookie)
    return []
  const all = Array.isArray(setCookie) ? setCookie : [setCookie]
  return all.filter(entry => !entry.trimStart().toLowerCase().startsWith(`${name.toLowerCase()}=`))
}

/**
 * The longest a document may safely outlive the build that rendered it.
 *
 * This is the number to clamp a route rule against:
 *
 * ```ts
 * const sMaxAge = Math.min(300, skewCacheCeilingSeconds(retentionDays))
 * ```
 *
 * `retentionDays` is the only bound expressible without knowing the deploy
 * rate. `maxNumberOfVersions` is the tighter one in practice and cannot be
 * checked here, which is what the build-time guidance says out loud.
 */
export function skewCacheCeilingSeconds(retentionDays: number): number {
  if (!Number.isFinite(retentionDays))
    return 0
  return Math.max(0, Math.floor(retentionDays * 24 * 60 * 60))
}

/**
 * A route rule as far as this check is concerned.
 *
 * Nitro accepts several spellings of "cache this", and they do not all end up
 * in `headers`. `swr` and `isr` are normalised into `cache` during nitro's own
 * config pass and only become a `cache-control` header at request time, so a
 * check that reads `headers` alone sees nothing and stays silent on exactly the
 * rules most likely to outlive retention: `swr: 31536000` is a year.
 */
export interface InspectableRouteRule {
  headers?: Record<string, string>
  // Deliberately loose. Nitro's own `NitroRouteConfig` carries far more than
  // this check reads, and narrowing it here would force a cast at the one call
  // site that matters. Every field is re-checked before use.
  cache?: unknown
  swr?: boolean | number
  // Also accepts Vercel's `{ expiration }` object form, narrowed at use.
  isr?: unknown
}

export interface OverlongRoute {
  route: string
  seconds: number
  /** Which spelling declared it, so the warning names the line to edit. */
  source: 'cache-control' | 'cache' | 'swr' | 'isr'
  /** The window came from `max-age` alone, so CDN intent is a guess. */
  fromMaxAgeAlone: boolean
}

function ruleWindow(rule: InspectableRouteRule): { seconds: number, source: OverlongRoute['source'], fromMaxAgeAlone: boolean } | null {
  const header = rule.headers
    && Object.entries(rule.headers).find(([name]) => name.toLowerCase() === 'cache-control')?.[1]
  const fromHeader = sharedCacheSeconds(header)
  if (fromHeader !== null)
    return { seconds: fromHeader, source: 'cache-control', fromMaxAgeAlone: sharedWindowFromMaxAgeAlone(header) }

  const cache = rule.cache as { maxAge?: unknown, staleMaxAge?: unknown } | undefined
  if (cache && typeof cache === 'object' && typeof cache.maxAge === 'number') {
    const stale = typeof cache.staleMaxAge === 'number' ? cache.staleMaxAge : 0
    return { seconds: cache.maxAge + stale, source: 'cache', fromMaxAgeAlone: false }
  }

  // `true` means "cache indefinitely" for both, which no retention window can
  // cover, so it is reported as unbounded rather than skipped.
  if (typeof rule.swr === 'number')
    return { seconds: rule.swr, source: 'swr', fromMaxAgeAlone: false }
  if (rule.swr === true)
    return { seconds: Number.POSITIVE_INFINITY, source: 'swr', fromMaxAgeAlone: false }
  if (typeof rule.isr === 'number')
    return { seconds: rule.isr, source: 'isr', fromMaxAgeAlone: false }
  if (rule.isr === true)
    return { seconds: Number.POSITIVE_INFINITY, source: 'isr', fromMaxAgeAlone: false }
  // Vercel spells it `isr: { expiration }`, where `false` means never expire.
  if (rule.isr && typeof rule.isr === 'object') {
    const expiration = (rule.isr as { expiration?: unknown }).expiration
    if (typeof expiration === 'number')
      return { seconds: expiration, source: 'isr', fromMaxAgeAlone: false }
    if (expiration === false)
      return { seconds: Number.POSITIVE_INFINITY, source: 'isr', fromMaxAgeAlone: false }
  }

  return null
}

/**
 * Route rules that ask a shared cache to keep a document.
 *
 * Reads the app's own `routeRules` rather than a second copy of them, so a
 * warning points at the line the author wrote. Empty means the app never asked
 * for shared caching in its config, which is the signal used to stay quiet.
 */
export function cachingRouteRules(
  routeRules: Record<string, InspectableRouteRule | undefined>,
): OverlongRoute[] {
  const caching: OverlongRoute[] = []
  for (const [route, rule] of Object.entries(routeRules ?? {})) {
    if (!rule || typeof rule !== 'object')
      continue
    const window = ruleWindow(rule)
    if (window)
      caching.push({ route, seconds: window.seconds, source: window.source, fromMaxAgeAlone: window.fromMaxAgeAlone })
  }
  return caching
}

/** Route rules whose declared window outlives the retained builds. */
export function overlongRouteRules(
  routeRules: Record<string, InspectableRouteRule | undefined>,
  ceilingSeconds: number,
): OverlongRoute[] {
  return cachingRouteRules(routeRules).filter(route => route.seconds > ceilingSeconds)
}

/**
 * Reads the request fields the policy needs off an H3 event.
 *
 * Takes the header getter rather than importing one, so this module stays free
 * of a runtime dependency and the policy is testable as plain data.
 */
export function htmlCacheRequestFromEvent(
  event: { method?: string, node?: { req?: { method?: string } } },
  getHeader: (event: never, name: string) => string | undefined,
): HtmlCacheRequest {
  return {
    method: event.method ?? event.node?.req?.method ?? 'GET',
    secFetchDest: getHeader(event as never, 'sec-fetch-dest'),
    accept: getHeader(event as never, 'accept'),
    cookie: getHeader(event as never, 'cookie'),
    authorization: getHeader(event as never, 'authorization')
      ?? getHeader(event as never, 'proxy-authorization'),
  }
}

/**
 * The response's `Set-Cookie` entries, one per cookie, across h3 majors.
 *
 * This cannot go through `getResponseHeader`. On h3 v2 the response headers are
 * a `Headers` instance, and `Headers.get('set-cookie')` returns every cookie
 * joined with `", "` as one string. Filtering that string treats two cookies as
 * one value: measured on h3 2.0.1, a `__nkpv` set before an app's `session`
 * cookie produced a single joined value beginning `__nkpv=`, so a prefix filter
 * dropped both and deleted the app's cookie. `getSetCookie()` is the only
 * accessor that separates them, and it exists solely on `Headers`.
 *
 * h3 v1 appends each cookie as its own header, so the array comes back from
 * `getResponseHeader` directly. Feature detection rather than a version check,
 * because the shape is what matters.
 */
export function readSetCookies(
  event: { res?: { headers?: { getSetCookie?: () => string[] } } },
  fallback: string | string[] | number | undefined,
): string[] {
  const headers = event.res?.headers
  if (headers && typeof headers.getSetCookie === 'function')
    return headers.getSetCookie()
  if (Array.isArray(fallback))
    return fallback
  return fallback === undefined || fallback === '' ? [] : [String(fallback)]
}

/**
 * What this module can promise another module about cached documents.
 *
 * Duplicated verbatim in `@harlan-zw/nuxt-cloudflare`, which forces
 * `private, no-store` on HTML because a cached document can name chunks a later
 * deploy deleted. Retention is the answer to that, so this is how retention is
 * stated in a form another module can act on.
 *
 * It states a bound and never an instruction. A module should not be able to
 * tell another module to lower a safety rail; it can only supply the number the
 * other module needs to make its own decision.
 *
 * Kept to a versioned, field-only interface so the two copies cannot drift in
 * behaviour, only in whether they recognise a version. A consumer that reads an
 * unknown `v` is expected to ignore it rather than guess.
 */
export interface HtmlCacheCapability {
  v: 1
  by: string
  /** Seconds a document may outlive its build and still resolve every chunk. */
  documentTtlCeilingSeconds: number
  basis: 'observed-retained-builds' | 'retention-days' | 'none'
  /** Requests for a retired build's chunks resolve instead of 404. */
  assetRecovery: boolean
}

/**
 * The shortest interval this module is willing to assume between deploys.
 *
 * `maxNumberOfVersions` prunes by rank, not by age, so the real retention
 * window is `maxNumberOfVersions x deploy interval` and no configuration knows
 * the second term. Publishing `retentionDays` alone overstates it badly:
 * measured on skilld.dev, two deploys landed four minutes apart, so a
 * ten-version window can be spent in under an hour while the config still says
 * thirty days.
 *
 * An hour is the assumption. It is wrong for anyone deploying faster, which is
 * why `overlongRouteRules` still names any rule that outlives the published
 * number, and why the ceiling is a floor on honesty rather than a measurement.
 */
const ASSUMED_MIN_DEPLOY_INTERVAL_SECONDS = 60 * 60

/**
 * The capability this configuration supports, or null when it supports none.
 *
 * `assetRecovery` is the load-bearing field, not the ceiling. Retaining old
 * builds is what turns a stale document from a `ChunkLoadError` into a slow
 * page, and a consumer is expected to refuse the whole handshake without it.
 * It is true only when this module actually stores asset bytes: the preset
 * says where old builds would be served from, `bundleAssets` and `storage`
 * decide whether any were kept.
 *
 * The ceiling is the smaller of what time allows and what rank allows, because
 * whichever binds first is the one that ends the guarantee.
 */
export function htmlCacheCapability(input: {
  retentionDays: number
  maxNumberOfVersions: number
  assetRecovery: boolean
}): HtmlCacheCapability | null {
  if (!input.assetRecovery)
    return null

  const byTime = skewCacheCeilingSeconds(input.retentionDays)
  const byRank = Math.max(0, Math.floor(input.maxNumberOfVersions)) * ASSUMED_MIN_DEPLOY_INTERVAL_SECONDS
  const ceiling = Math.min(byTime, byRank)
  if (ceiling <= 0)
    return null

  return {
    v: 1,
    by: 'nuxt-skew-protection',
    documentTtlCeilingSeconds: ceiling,
    basis: 'retention-days',
    assetRecovery: true,
  }
}
