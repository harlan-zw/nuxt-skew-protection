import type { CookieSerializeOptions } from 'cookie-es'
import type { BackoffQueue } from './app/utils/backoff-queue'

export type AssetRecoveryConfig
  = | { _tag: 'disabled' }
    | {
      _tag: 'cloudflare'
      buildAssetsPath: string
      recoveryPath: string
    }

export interface NuxtSkewProtectionPrivateRuntimeConfig {
  vercelCookiePath?: string
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

/**
 * App-scoped version detection state.
 *
 * Lives on the Nuxt app instance so update detection survives component
 * unmounts: the connection stays open across navigations, so its message
 * listener and backoff queue must too.
 */
export interface SkewVersionDetection {
  /** The version listener is registered once per app */
  listenerInstalled?: boolean
  /** Backoff queue driving `checkForUpdates` after a version mismatch */
  queue?: BackoffQueue
  /** Last server version we started checks for (dedupes reconnections) */
  lastDetectedServerVersion?: string
  /** Last manifest id we fired `app:manifest:update` for */
  lastProcessedManifestId?: string
}
