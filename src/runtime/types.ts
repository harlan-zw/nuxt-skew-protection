export interface NuxtSkewProtectionRuntimeConfig {
  sse: boolean
  durableObjects: boolean
  cookieName: string
  debug: boolean
}

export interface ModuleInvalidatedPayload {
  deletedChunks: string[]
  invalidatedModules: string[]
}

declare module '#app' {
  interface RuntimeNuxtHooks {
    'skew-protection:module-invalidated': (payload: ModuleInvalidatedPayload) => void | Promise<void>
  }
}
