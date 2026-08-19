/**
 * Decides whether one document response may be held in a shared cache.
 *
 * Skew protection retains the last `maxNumberOfVersions` builds for
 * `retentionDays`, so a document stays loadable for as long as the build that
 * rendered it survives. That is what makes caching HTML safe at all. The unit
 * mismatch is the trap: a cache TTL is seconds, retention by version count is
 * deploys, and the two only agree if the deploy rate is known. `htmlCacheHeaders`
 * therefore takes an explicit TTL and the module states the guarantee it needs.
 *
 * Everything here is pure. The cookie middleware asks the request-side question
 * before the handler runs, the response hook asks the full one after, and
 * neither depends on the other having run.
 */

export interface HtmlCacheHeadersOptions {
  /**
   * Seconds a shared cache may serve the document without revalidating.
   * @default 60
   */
  maxAge: number
  /**
   * Seconds a shared cache may serve a stale document while it revalidates.
   * @default 60
   */
  staleWhileRevalidate: number
}

export type HtmlCacheSkipReason
  = | 'disabled'
    | 'not-cacheable-method'
    | 'not-document'
    | 'request-has-cookie'
    | 'not-ok-status'
    | 'response-sets-cookie'

export type HtmlCacheDecision
  = | { _tag: 'cacheable' }
    | { _tag: 'skipped', reason: HtmlCacheSkipReason }

export interface HtmlCacheRequest {
  method: string
  secFetchDest: string | undefined
  accept: string | undefined
  cookie: string | undefined
}

export interface HtmlCacheResponse {
  status: number
  hasSetCookie: boolean
}

function isDocumentRequest(request: HtmlCacheRequest): boolean {
  // `sec-fetch-dest` is the reliable signal and every current browser sends it.
  // Fall back to `accept` for clients that do not, which is most crawlers, and
  // crawlers are the traffic a shared cache helps most.
  if (request.secFetchDest)
    return request.secFetchDest === 'document'
  return request.accept?.includes('text/html') === true
}

/**
 * The half of the verdict knowable before the handler runs.
 *
 * The cookie middleware needs an answer at request time, so this is the most
 * that can be decided then. The response hook re-asks it with the response in
 * hand, which can only ever narrow the result, never widen it.
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
  // reaching this code, because shared caches do not vary on Cookie. That is
  // why the option is opt-in: only enable it when the rendered document does
  // not depend on who asked for it.
  if (request.cookie)
    return { _tag: 'skipped', reason: 'request-has-cookie' }

  return { _tag: 'cacheable' }
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
  // during a deploy would be served to everyone for the whole window. Only a
  // 200 is a document worth keeping.
  if (response.status !== 200)
    return { _tag: 'skipped', reason: 'not-ok-status' }

  // The app may set its own cookie while rendering, and a shared cache stores
  // headers with the body. Anything still carrying Set-Cookie here is not ours
  // to reason about, so leave it alone.
  if (response.hasSetCookie)
    return { _tag: 'skipped', reason: 'response-sets-cookie' }

  return { _tag: 'cacheable' }
}

export function htmlCacheHeaderValues(options: HtmlCacheHeadersOptions): {
  cacheControl: string
  cdnCacheControl: string
} {
  return {
    // The browser revalidates every time. Only the shared cache holds the
    // document, so a back-button never resurrects a build that has since been
    // pruned, and one user's copy is never older than one round trip.
    cacheControl: 'public, max-age=0, must-revalidate',
    cdnCacheControl: `public, s-maxage=${options.maxAge}, stale-while-revalidate=${options.staleWhileRevalidate}`,
  }
}

/**
 * The longest a document may outlive the build that rendered it, in seconds.
 *
 * `retentionDays` is the only bound expressible without knowing the deploy
 * rate. `maxNumberOfVersions` is the tighter one in practice and cannot be
 * checked here, which is what the build-time guidance says out loud.
 */
export function maxSafeHtmlCacheSeconds(retentionDays: number): number {
  if (!Number.isFinite(retentionDays))
    return 0
  return Math.max(0, Math.floor(retentionDays * 24 * 60 * 60))
}

export function resolveHtmlCacheHeadersOptions(
  input: boolean | Partial<HtmlCacheHeadersOptions> | undefined,
): HtmlCacheHeadersOptions | false {
  if (!input)
    return false
  const defaults: HtmlCacheHeadersOptions = { maxAge: 60, staleWhileRevalidate: 60 }
  if (input === true)
    return defaults
  return {
    maxAge: input.maxAge ?? defaults.maxAge,
    staleWhileRevalidate: input.staleWhileRevalidate ?? defaults.staleWhileRevalidate,
  }
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
