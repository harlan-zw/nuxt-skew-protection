import type { CookieSerializeOptions } from 'cookie-es'
import type { HtmlCacheHeadersOptions } from './server/utils/html-cache-policy'

export type AssetRecoveryConfig
  = | { _tag: 'disabled' }
    | {
      _tag: 'cloudflare'
      buildAssetsPath: string
      recoveryPath: string
    }

export type { HtmlCacheHeadersOptions }

export interface NuxtSkewProtectionPrivateRuntimeConfig {
  vercelCookiePath?: string
  /**
   * Present only when `htmlCacheHeaders` is enabled. Server-side only: the
   * client never needs it, and a cached document must not advertise how long
   * it may be cached for.
   */
  htmlCacheHeaders?: HtmlCacheHeadersOptions
}

export interface NuxtSkewProtectionRuntimeConfig {
  /**
   * Path prefix for the module's runtime endpoints (`/ws`, `/sse`, `/health`,
   * `/route`, `/subscribe-stats`, `/admin/stats`). Defaults to `/__skew`. Set a
   * sub-path (e.g. `/pro/__skew`) when the app is path-routed behind a worker
   * that only owns part of the host, so the endpoints resolve to this app.
   */
  basePath: string
  assetRecovery: AssetRecoveryConfig
  cookie: false | Omit<CookieSerializeOptions, 'encode'> & {
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
  assetRecovery: AssetRecoveryConfig
  cookie: false | Omit<CookieSerializeOptions, 'encode'> & {
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
