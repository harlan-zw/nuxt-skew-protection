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

declare module '#app' {
  interface RuntimeNuxtHooks {
    'skew-protection:chunks-outdated': (payload: ChunksOutdatedPayload) => void | Promise<void>
  }
}
