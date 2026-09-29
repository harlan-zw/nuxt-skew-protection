const SKEW_SEGMENT = '__skew'

/** Default version cookie name for a single root-mounted app. */
export const DEFAULT_COOKIE_NAME = '__nkpv'

export interface ResolveBasePathInput {
  /**
   * Explicit `basePath` module option, if the user set one. Treated as the full
   * public endpoint prefix (already including the skew segment).
   */
  basePath?: string
  /**
   * Nuxt app config (`nuxt.options.app`) used to auto-detect the worker mount
   * point when `basePath` is not set.
   */
  app?: { baseURL?: string, buildAssetsDir?: string }
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '')
}

export function resolveBuildAssetsPath(
  app: { baseURL?: string, buildAssetsDir?: string } = {},
): string {
  return `${joinSegments(app.baseURL, app.buildAssetsDir || '/_nuxt/')}/`
}

function joinSegments(...values: (string | undefined)[]): string {
  const path = values.map(value => trimSlashes(value || '')).filter(Boolean).join('/')
  return `/${path}`
}

function isUnder(path: string, prefix: string): boolean {
  return prefix === '/' || path === prefix || path.startsWith(`${prefix}/`)
}

/**
 * Resolve the public URL path prefix for the module's runtime endpoints (`/ws`,
 * `/sse`, `/health`, `/route`, `/subscribe-stats`, `/admin/stats`, `/asset`).
 *
 * The result is the absolute path a browser requests, so it always sits inside
 * `app.baseURL`. Register server handlers with `toServerRoute`, because Nitro
 * mounts every handler relative to `app.baseURL`.
 *
 * Priority:
 * 1. An explicit `basePath` option. It is the full public prefix. If it is
 *    outside `app.baseURL`, Nitro cannot serve it, so it is joined under
 *    `app.baseURL` instead.
 * 2. The path before `_nuxt` in an absolute `app.buildAssetsDir`, under
 *    `app.baseURL`. A worker that only owns part of a shared host bakes its
 *    mount point into the asset path (e.g. a Pro dashboard serving chunks from
 *    `/pro/_nuxt/` owns `/pro`). Any namespace inside `_nuxt`, such as
 *    `/_nuxt/v2/`, remains part of the asset path rather than becoming the app
 *    mount. The skew endpoints must sit beside the chunks they guard so the
 *    SAME worker serves both; otherwise the websocket leaks to whichever app
 *    owns the host route and compares against the wrong deployment.
 * 3. `app.baseURL` for apps mounted under the standard Nuxt base.
 * 4. `/__skew` at the root (default single-app case).
 */
export function resolveBasePath(input: ResolveBasePathInput = {}): string {
  const app = input.app || {}
  const baseURL = joinSegments(app.baseURL)

  if (input.basePath) {
    const explicit = `/${trimSlashes(input.basePath)}`
    return isUnder(explicit, baseURL) ? explicit : joinSegments(baseURL, explicit)
  }

  // Absolute buildAssetsDir: the prefix before `_nuxt` is the mount point.
  const assetsDir = app.buildAssetsDir || ''
  let mount = ''
  if (assetsDir.startsWith('/')) {
    const segments = trimSlashes(assetsDir).split('/').filter(Boolean)
    const nuxtAssetsIndex = segments.indexOf('_nuxt')
    const mountEnd = nuxtAssetsIndex === -1 ? segments.length - 1 : nuxtAssetsIndex
    mount = segments.slice(0, mountEnd).join('/')
  }

  return joinSegments(baseURL, mount, SKEW_SEGMENT)
}

/**
 * Convert a public path from `resolveBasePath` into a Nitro handler route.
 * Nitro prefixes every handler route with `app.baseURL`, so the route must not
 * repeat it.
 *
 * @example toServerRoute('/app/__skew/sse', '/app/') // '/__skew/sse'
 * @example toServerRoute('/pro/__skew/sse', '/')     // '/pro/__skew/sse'
 */
export function toServerRoute(publicPath: string, baseURL: string | undefined): string {
  const base = joinSegments(baseURL)
  if (base === '/' || !isUnder(publicPath, base))
    return publicPath
  return publicPath.slice(base.length) || '/'
}

/**
 * Resolve the version cookie name.
 *
 * Path-routed apps share a host (and therefore a cookie jar) with whatever app
 * owns the root route, so a single `__nkpv` would clobber across them. Derive a
 * per-mount suffix from the resolved `basePath` (the same signal that namespaces
 * the endpoints) so each app gets a distinct cookie with zero config. A root app
 * keeps the bare `__nkpv` for backwards compatibility. An explicit name wins.
 *
 * @example resolveCookieName(undefined, '/pro/__skew') // '__nkpv_pro'
 * @example resolveCookieName(undefined, '/__skew')     // '__nkpv'
 */
export function resolveCookieName(explicitName: string | undefined, basePath: string): string {
  if (explicitName)
    return explicitName

  const segments = trimSlashes(basePath).split('/').filter(Boolean)
  // Drop the trailing skew segment; what remains is the mount prefix.
  if (segments[segments.length - 1] === SKEW_SEGMENT)
    segments.pop()

  const slug = segments.join('_')
  return slug ? `${DEFAULT_COOKIE_NAME}_${slug}` : DEFAULT_COOKIE_NAME
}
