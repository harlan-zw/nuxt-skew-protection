import type { CookieSerializeOptions } from 'cookie-es'

export interface NuxtSkewProtectionRuntimeConfig {
  sse: boolean
  durableObjects: boolean
  cookie: Omit<CookieSerializeOptions, 'encode'> & {
    name?: string
  }
  debug: boolean
}

export interface SkewProtectionRuntimeConfig {
  cookie: Omit<CookieSerializeOptions, 'encode'> & {
    name: string
  }
  buildId: string
  debug: boolean
}

export interface ChunksOutdatedPayload {
  deletedChunks: string[]
  invalidatedModules: string[]
  passedReleases: string[]
}
