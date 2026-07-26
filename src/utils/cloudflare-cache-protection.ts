interface PublicAssetDirectory {
  baseURL?: string
  fallthrough?: boolean
  maxAge?: number
}

interface RouteRule {
  headers?: Record<string, string>
}

interface NitroAssetConfig {
  publicAssets?: Array<PublicAssetDirectory | undefined>
  routeRules?: Record<string, RouteRule>
}

export type CloudflareCacheProtectionResult
  = | {
    _tag: 'Protected'
    route: string
  }
  | {
    _tag: 'BuildAssetDirectoryNotFound'
    buildAssetsDir: string
  }

function normalizeAssetBase(value: string) {
  const path = value.replace(/^\/+|\/+$/g, '')
  return path ? `/${path}` : '/'
}

export function applyCloudflareCacheProtection(
  config: NitroAssetConfig,
  buildAssetsDir: string,
): CloudflareCacheProtectionResult {
  const normalizedBuildAssetsDir = normalizeAssetBase(buildAssetsDir)
  const buildAssetDirectory = config.publicAssets?.find((asset): asset is PublicAssetDirectory =>
    !!asset && normalizeAssetBase(asset.baseURL || '/') === normalizedBuildAssetsDir,
  )

  if (!buildAssetDirectory) {
    return {
      _tag: 'BuildAssetDirectoryNotFound',
      buildAssetsDir,
    }
  }

  buildAssetDirectory.fallthrough = true

  const route = `${normalizedBuildAssetsDir}/**`
  config.routeRules ||= {}
  const routeRule = config.routeRules[route] ||= {}
  const headers = routeRule.headers ||= {}
  const hasCacheControl = Object.keys(headers).some(header => header.toLowerCase() === 'cache-control')

  if (!hasCacheControl && buildAssetDirectory.maxAge && buildAssetDirectory.maxAge > 0) {
    headers['cache-control'] = `public, max-age=${Math.floor(buildAssetDirectory.maxAge)}, immutable`
  }

  return {
    _tag: 'Protected',
    route,
  }
}
