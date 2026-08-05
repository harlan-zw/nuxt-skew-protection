import type { CookieSerializeOptions } from 'cookie-es'

export interface NuxtSkewProtectionRuntimeConfig {
  /**
   * Path prefix for the module's runtime endpoints (`/ws`, `/sse`, `/health`,
   * `/route`, `/subscribe-stats`, `/admin/stats`). Defaults to `/__skew`. Set a
   * sub-path (e.g. `/pro/__skew`) when the app is path-routed behind a worker
   * that only owns part of the host, so the endpoints resolve to this app.
   */
  basePath: string
  cookie: false | Omit<CookieSerializeOptions, 'encode'> & {
    name?: string
  }
  debug: boolean
  connectionTracking?: boolean
  routeTracking?: boolean
  ipTracking?: boolean
  reloadStrategy?: 'prompt' | 'immediate' | 'idle' | false
  multiTab?: boolean
  discoveryURL?: string
  updatesEnabled?: boolean
  updateInterval?: number
}

export interface SkewProtectionRuntimeConfig {
  basePath: string
  cookie: false | Omit<CookieSerializeOptions, 'encode'> & {
    name: string
  }
  debug: boolean
  connectionTracking?: boolean
  routeTracking?: boolean
  ipTracking?: boolean
  reloadStrategy?: 'prompt' | 'immediate' | 'idle' | false
  multiTab?: boolean
  discoveryURL?: string
  updatesEnabled?: boolean
  updateInterval?: number
}
