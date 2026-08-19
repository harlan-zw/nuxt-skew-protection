/**
 * Decides how long one document response may be held in a shared cache.
 *
 * Two different questions decide that, owned by two different parties, and
 * keeping them apart is the whole design:
 *
 * 1. How often does this page's content change? Only the app knows, and the
 *    answer differs per route. A skill page changes when its repo syncs; a
 *    trending board changes when the nightly job runs; an account page must
 *    never be shared at all. That is what `routes` expresses.
 * 2. How long may a document outlive the build that rendered it? Only the
 *    module knows, it is one number for the whole app, and it comes from
 *    `retentionDays` and `maxNumberOfVersions`. That is the ceiling, and it
 *    clamps every answer to the first question.
 *
 * Collapsing those two into a single global TTL is what the first version of
 * this did, and it forced every page onto the freshness budget of the most
 * volatile one.
 *
 * An app that already owns a cache policy should not use `routes` at all. It
 * should keep its own rules and clamp them with `skewCacheCeilingSeconds`. The
 * response hook never overwrites a `Cache-Control` the app already set, so the
 * two cannot fight.
 */

export interface HtmlCacheRule {
  /**
   * Seconds a shared cache may serve the document without revalidating.
   */
  maxAge: number
  /**
   * Seconds a shared cache may serve a stale document while it revalidates.
   */
  staleWhileRevalidate: number
}

export type HtmlCacheRouteRule = false | Partial<HtmlCacheRule>

export interface HtmlCacheHeadersOptions extends HtmlCacheRule {
  /**
   * Per-route overrides keyed by path pattern, for pages whose content changes
   * on a different clock to the default. `false` opts a route out entirely.
   *
   * Patterns are `/exact`, `/prefix/*` for one segment, and `/prefix/**` for
   * any depth. The most specific match wins, and an exact match always beats a
   * pattern.
   */
  routes: Record<string, HtmlCacheRouteRule>
}

export type HtmlCacheSkipReason
  = | 'disabled'
    | 'not-cacheable-method'
    | 'not-document'
    | 'request-has-cookie'
    | 'route-opted-out'
    | 'not-ok-status'
    | 'response-sets-cookie'
    | 'app-set-cache-control'

export type HtmlCacheDecision
  = | { _tag: 'cacheable', rule: HtmlCacheRule }
    | { _tag: 'skipped', reason: HtmlCacheSkipReason }

export interface HtmlCacheRequest {
  method: string
  path: string
  secFetchDest: string | undefined
  accept: string | undefined
  cookie: string | undefined
}

export interface HtmlCacheResponse {
  status: number
  hasSetCookie: boolean
  hasCacheControl: boolean
}

function isDocumentRequest(request: HtmlCacheRequest): boolean {
  // `sec-fetch-dest` is the reliable signal and every current browser sends it.
  // Fall back to `accept` for clients that do not, which is most crawlers, and
  // crawlers are the traffic a shared cache helps most.
  if (request.secFetchDest)
    return request.secFetchDest === 'document'
  return request.accept?.includes('text/html') === true
}

function pathname(path: string): string {
  const cut = path.search(/[?#]/)
  return cut === -1 ? path : path.slice(0, cut)
}

interface PatternMatch {
  matched: boolean
  /** Higher wins. Exact beats deep glob beats shallow glob. */
  specificity: number
}

export function matchRoutePattern(pattern: string, path: string): PatternMatch {
  const target = pathname(path)

  // The wildcard is a suffix, not a segment, so `/@**` works as well as
  // `/gh/**`. Identity paths like `/@handle` have no separator before the
  // wildcard and are exactly the routes worth opting out.
  if (pattern.endsWith('**')) {
    const prefix = pattern.slice(0, -2)
    const bare = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
    const matched = target.startsWith(prefix) || target === bare
    return { matched, specificity: bare.length * 10 }
  }

  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1)
    if (!target.startsWith(prefix))
      return { matched: false, specificity: 0 }
    // One segment only. A deeper path belongs to `**`, not here.
    const rest = target.slice(prefix.length)
    return {
      matched: rest.length > 0 && !rest.includes('/'),
      specificity: prefix.length * 10 + 1,
    }
  }

  return { matched: target === pattern, specificity: 1_000_000 + pattern.length }
}

/**
 * The rule for one path, or `false` when the route opted out.
 *
 * Returns the option defaults when no pattern matches, so adding `routes` never
 * silently drops a page out of the cache.
 */
export function resolveRouteRule(
  options: HtmlCacheHeadersOptions,
  path: string,
): HtmlCacheRule | false {
  let best: { rule: HtmlCacheRouteRule, specificity: number } | undefined

  for (const [pattern, rule] of Object.entries(options.routes)) {
    const match = matchRoutePattern(pattern, path)
    if (!match.matched)
      continue
    if (!best || match.specificity > best.specificity)
      best = { rule, specificity: match.specificity }
  }

  if (!best)
    return { maxAge: options.maxAge, staleWhileRevalidate: options.staleWhileRevalidate }
  if (best.rule === false)
    return false
  return {
    maxAge: best.rule.maxAge ?? options.maxAge,
    staleWhileRevalidate: best.rule.staleWhileRevalidate ?? options.staleWhileRevalidate,
  }
}

/**
 * The half of the verdict knowable before the handler runs.
 *
 * The cookie middleware needs an answer at request time, so this is the most
 * that can be decided then. The response hook re-asks it with the response in
 * hand, which can only narrow the result, never widen it.
 */
export function resolveHtmlCacheRequestPolicy(
  options: HtmlCacheHeadersOptions | false,
  request: HtmlCacheRequest,
): HtmlCacheDecision {
  if (!options)
    return { _tag: 'skipped', reason: 'disabled' }

  if (request.method !== 'GET' && request.method !== 'HEAD')
    return { _tag: 'skipped', reason: 'not-cacheable-method' }

  if (!isDocumentRequest(request))
    return { _tag: 'skipped', reason: 'not-document' }

  // A request carrying any cookie may render a personalised document, and a
  // shared cache keys on the URL alone. Never let such a response populate it.
  //
  // This bounds what goes in, not what comes out. A cache that already holds
  // the anonymous document will serve it to a cookied request without ever
  // reaching this code, because shared caches do not vary on Cookie. Opt a
  // route out with `routes` when its output depends on who asked.
  if (request.cookie)
    return { _tag: 'skipped', reason: 'request-has-cookie' }

  const rule = resolveRouteRule(options, request.path)
  if (rule === false)
    return { _tag: 'skipped', reason: 'route-opted-out' }

  return { _tag: 'cacheable', rule }
}

export function resolveHtmlCachePolicy(
  options: HtmlCacheHeadersOptions | false,
  request: HtmlCacheRequest,
  response: HtmlCacheResponse,
): HtmlCacheDecision {
  const requestPolicy = resolveHtmlCacheRequestPolicy(options, request)
  if (requestPolicy._tag !== 'cacheable')
    return requestPolicy

  // Caching an error page is worse than not caching at all: a transient 500
  // during a deploy would be served to everyone for the whole window.
  if (response.status !== 200)
    return { _tag: 'skipped', reason: 'not-ok-status' }

  // The app may set its own cookie while rendering, and a shared cache stores
  // headers with the body.
  if (response.hasSetCookie)
    return { _tag: 'skipped', reason: 'response-sets-cookie' }

  // The app already decided. An app with its own cache layer knows things this
  // module cannot, so it wins outright rather than being overwritten. Reach for
  // `skewCacheCeilingSeconds` to keep those numbers inside the skew bound.
  if (response.hasCacheControl)
    return { _tag: 'skipped', reason: 'app-set-cache-control' }

  return requestPolicy
}

export function htmlCacheHeaderValues(rule: HtmlCacheRule): {
  cacheControl: string
  cdnCacheControl: string
} {
  return {
    // The browser revalidates every time. Only the shared cache holds the
    // document, so a back-button never resurrects a build that has since been
    // pruned, and one user's copy is never older than one round trip.
    cacheControl: 'public, max-age=0, must-revalidate',
    cdnCacheControl: `public, s-maxage=${rule.maxAge}, stale-while-revalidate=${rule.staleWhileRevalidate}`,
  }
}

/**
 * The longest a document may safely outlive the build that rendered it.
 *
 * This is the number an app with its own cache policy should clamp against:
 *
 * ```ts
 * const maxAge = Math.min(myRule.maxAge, skewCacheCeilingSeconds(retentionDays))
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

export function resolveHtmlCacheHeadersOptions(
  input: boolean | (Partial<HtmlCacheRule> & { routes?: Record<string, HtmlCacheRouteRule> }) | undefined,
): HtmlCacheHeadersOptions | false {
  if (!input)
    return false
  const defaults: HtmlCacheHeadersOptions = { maxAge: 60, staleWhileRevalidate: 60, routes: {} }
  if (input === true)
    return defaults
  return {
    maxAge: input.maxAge ?? defaults.maxAge,
    staleWhileRevalidate: input.staleWhileRevalidate ?? defaults.staleWhileRevalidate,
    routes: input.routes ?? {},
  }
}

/**
 * Every configured window that exceeds the skew ceiling, named by route.
 *
 * Used at build time so the warning points at the rule to change rather than
 * saying the config is wrong in general.
 */
export function overlongRoutes(
  options: HtmlCacheHeadersOptions,
  ceilingSeconds: number,
): { route: string, seconds: number }[] {
  const windows: { route: string, seconds: number }[] = [
    { route: '(default)', seconds: options.maxAge + options.staleWhileRevalidate },
  ]
  for (const [pattern, rule] of Object.entries(options.routes)) {
    if (rule === false)
      continue
    windows.push({
      route: pattern,
      seconds: (rule.maxAge ?? options.maxAge) + (rule.staleWhileRevalidate ?? options.staleWhileRevalidate),
    })
  }
  return windows.filter(w => w.seconds > ceilingSeconds)
}

/**
 * Reads the request fields the policy needs off an H3 event.
 *
 * Takes the header getter rather than importing one, so this module stays free
 * of a runtime dependency and the policy is testable as plain data.
 */
export function htmlCacheRequestFromEvent(
  event: { path?: string, method?: string, node?: { req?: { method?: string, url?: string } } },
  getHeader: (event: never, name: string) => string | undefined,
): HtmlCacheRequest {
  return {
    method: event.method ?? event.node?.req?.method ?? 'GET',
    path: event.path ?? event.node?.req?.url ?? '/',
    secFetchDest: getHeader(event as never, 'sec-fetch-dest'),
    accept: getHeader(event as never, 'accept'),
    cookie: getHeader(event as never, 'cookie'),
  }
}
