export interface NuxtSkewProtectionRuntimeConfig {
  sse: boolean
  durableObjects: boolean
  cookieName: string
  cookie: {
    path: string
    sameSite: 'strict' | 'lax' | 'none' | boolean
    maxAge: number
  }
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
