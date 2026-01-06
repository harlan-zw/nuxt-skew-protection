import type { CookieSerializeOptions } from 'cookie-es'

export interface NuxtSkewProtectionRuntimeConfig {
  sse: boolean
  durableObjects: boolean
  cookie: Omit<CookieSerializeOptions, 'encode'> & {
    name?: string
  }
  debug: boolean
  connectionTracking?: boolean
  routeTracking?: boolean
  ipTracking?: boolean
}

export interface SkewProtectionRuntimeConfig {
  cookie: Omit<CookieSerializeOptions, 'encode'> & {
    name: string
  }
  debug: boolean
  connectionTracking?: boolean
  routeTracking?: boolean
  ipTracking?: boolean
}

export interface ChunksOutdatedPayload {
  deletedChunks: string[]
  invalidatedModules: string[]
  passedReleases: string[]
}
