const SKEW_SEGMENT = '__skew'

/** Default version cookie name for a single root-mounted app. */
export const DEFAULT_COOKIE_NAME = '__nkpv'

export interface ResolveBasePathInput {
  /**
   * Explicit `basePath` module option, if the user set one. Treated as the full
   * endpoint prefix (already including the skew segment) and used as-is.
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

/**
 * Resolve the path prefix for the module's runtime endpoints (`/ws`, `/sse`,
 * `/health`, `/route`, `/subscribe-stats`, `/admin/stats`).
 *
 * Priority:
 * 1. An explicit `basePath` option — used verbatim (slash-normalized).
 * 2. The parent directory of an absolute `app.buildAssetsDir`. A worker that
 *    only owns part of a shared host bakes its mount point into the asset path
 *    (e.g. a Pro dashboard serving chunks from `/pro/_nuxt/` owns `/pro`). The
 *    skew endpoints must sit beside the chunks they guard so the SAME worker
 *    serves both — otherwise the websocket leaks to whichever app owns the host
 *    route and compares against the wrong deployment.
 * 3. `app.baseURL` for apps mounted under the standard Nuxt base.
 * 4. `/__skew` at the root (default single-app case).
 */
export function resolveBasePath(input: ResolveBasePathInput = {}): string {
  if (input.basePath)
    return `/${trimSlashes(input.basePath)}`

  const app = input.app || {}

  // 2) absolute buildAssetsDir → its parent dir is the worker mount point.
  const assetsDir = app.buildAssetsDir || ''
  let mount = ''
  if (assetsDir.startsWith('/')) {
    const segments = trimSlashes(assetsDir).split('/').filter(Boolean)
    // Drop the assets-dir leaf (e.g. `_nuxt`); the prefix is the mount point.
    mount = segments.slice(0, -1).join('/')
  }

  // 3) otherwise fall back to the app baseURL.
  if (!mount)
    mount = trimSlashes(app.baseURL || '')

  return mount ? `/${mount}/${SKEW_SEGMENT}` : `/${SKEW_SEGMENT}`
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
