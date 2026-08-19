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
 */

export type HtmlCacheSkipReason
  = | 'disabled'
    | 'not-cacheable-method'
    | 'not-document'
    | 'request-has-cookie'
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
export function sharedCacheSeconds(cacheControl: string | undefined): number | null {
  if (!cacheControl)
    return null
  const value = cacheControl.toLowerCase()
  if (value.includes('no-store') || value.includes('private'))
    return null

  const shared = directive(value, 's-maxage') ?? directive(value, 'max-age')
  if (shared === undefined || shared <= 0)
    return null

  return shared + (directive(value, 'stale-while-revalidate') ?? 0)
}

/**
 * Whether this response is one a shared cache was asked to keep.
 *
 * The app's `cache-control` is the whole input. However it got there, route
 * rules, a nitro plugin, or a handler, the answer is the same, so an app with
 * its own cache layer needs no special case.
 */
export function resolveHtmlCachePolicy(
  enabled: boolean,
  request: HtmlCacheRequest,
  response: { status: number, cacheControl: string | undefined },
): HtmlCacheDecision {
  if (!enabled)
    return { _tag: 'skipped', reason: 'disabled' }

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
 * Route rules whose declared window outlives the retained builds.
 *
 * Reads the app's own `routeRules` rather than a second copy of them, so the
 * warning points at the line the author wrote.
 */
export function overlongRouteRules(
  routeRules: Record<string, { headers?: Record<string, string> } | undefined>,
  ceilingSeconds: number,
): { route: string, seconds: number }[] {
  const overlong: { route: string, seconds: number }[] = []
  for (const [route, rule] of Object.entries(routeRules ?? {})) {
    const headers = rule?.headers
    if (!headers)
      continue
    const header = Object.entries(headers)
      .find(([name]) => name.toLowerCase() === 'cache-control')?.[1]
    const seconds = sharedCacheSeconds(header)
    if (seconds !== null && seconds > ceilingSeconds)
      overlong.push({ route, seconds })
  }
  return overlong
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
  }
}
