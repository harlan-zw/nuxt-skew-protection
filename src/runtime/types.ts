import type { CookieSerializeOptions } from 'cookie-es'

export interface NuxtSkewProtectionRuntimeConfig {
  sse: boolean
  durableObjects: boolean
  /**
   * Path prefix for the module's runtime endpoints (`/ws`, `/sse`, `/health`,
   * `/route`, `/subscribe-stats`, `/admin/stats`). Defaults to `/__skew`. Set a
   * sub-path (e.g. `/pro/__skew`) when the app is path-routed behind a worker
   * that only owns part of the host, so the endpoints resolve to this app.
   */
  basePath: string
  cookie: Omit<CookieSerializeOptions, 'encode'> & {
    name?: string
  }
  debug: boolean
  connectionTracking?: boolean
  routeTracking?: boolean
  ipTracking?: boolean
  reloadStrategy?: 'prompt' | 'immediate' | 'idle' | false
  multiTab?: boolean
}

export interface SkewProtectionRuntimeConfig {
  basePath: string
  cookie: Omit<CookieSerializeOptions, 'encode'> & {
    name: string
  }
  debug: boolean
  connectionTracking?: boolean
  routeTracking?: boolean
  ipTracking?: boolean
  reloadStrategy?: 'prompt' | 'immediate' | 'idle' | false
  multiTab?: boolean
}

export interface ChunksOutdatedPayload {
  deletedChunks: string[]
  invalidatedModules: string[]
  passedReleases: string[]
}
