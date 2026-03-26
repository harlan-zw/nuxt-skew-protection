export interface DebugResponse {
  version: string
  siteConfigUrl: string
  config: {
    cookie: Record<string, unknown>
    debug: boolean
    connectionTracking: boolean
    routeTracking: boolean
    ipTracking: boolean
    reloadStrategy: string | false
    multiTab: boolean
  }
  buildId: string
}

export interface VersionInfo {
  timestamp: string
  expires: string
  assets: string[]
  deletedChunks?: string[]
}

export interface SkewProtectionManifest {
  versions?: Record<string, VersionInfo>
}

export interface ProductionDebugResponse {
  health?: {
    ok: boolean
    version: string
    uptime: number
  } | null
  manifest?: {
    id?: string
    timestamp?: number
    matcher?: Record<string, unknown>
    prerendered?: string[]
    skewProtection?: SkewProtectionManifest
  } | null
  stats?: {
    total: number
    versions: Record<string, number>
    routes: Record<string, number>
  } | null
  errors: string[]
}
