export interface AssetHandlingOptions {
  bundleAssets?: boolean
  bundlePreviousDeploymentChunks?: boolean
}

export type BundleAssetsResolution
  = | { _tag: 'configured', bundleAssets: boolean }
    | { _tag: 'provider-default', provider: 'vercel', bundleAssets: false }
    | { _tag: 'module-default', bundleAssets: boolean }

export type VercelMiddlewareResolution
  = | { _tag: 'nitro-native' }
    | {
      _tag: 'module-compatibility'
      reason: 'disabled' | 'missing-deployment-id' | 'unsupported-nitro'
    }

export interface VercelMiddlewareContext {
  nitroSkewProtection: boolean | undefined
  nitroVersion: string
  deploymentId: string | undefined
}

export function resolveBundleAssets(
  configuredOptions: AssetHandlingOptions,
  moduleDefault: boolean,
  env: Record<string, string | undefined> = process.env,
): BundleAssetsResolution {
  if ('bundleAssets' in configuredOptions || 'bundlePreviousDeploymentChunks' in configuredOptions) {
    return {
      _tag: 'configured',
      bundleAssets: configuredOptions.bundleAssets
        ?? configuredOptions.bundlePreviousDeploymentChunks
        ?? moduleDefault,
    }
  }

  if (env.VERCEL_SKEW_PROTECTION_ENABLED === '1' && env.VERCEL_DEPLOYMENT_ID) {
    return {
      _tag: 'provider-default',
      provider: 'vercel',
      bundleAssets: false,
    }
  }

  return {
    _tag: 'module-default',
    bundleAssets: moduleDefault,
  }
}

export function resolveBuildMetadataTracking(
  resolution: BundleAssetsResolution,
  configured: boolean | undefined = undefined,
): boolean {
  return configured ?? (resolution.bundleAssets || resolution._tag === 'provider-default')
}

function supportsNativeVercelSkewProtection(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.\d+/.exec(version)
  if (!match)
    return false

  const major = Number(match[1])
  const minor = Number(match[2])
  return major > 2 || (major === 2 && minor >= 13)
}

export function resolveVercelMiddleware(context: VercelMiddlewareContext): VercelMiddlewareResolution {
  if (!context.nitroSkewProtection)
    return { _tag: 'module-compatibility', reason: 'disabled' }

  if (!context.deploymentId)
    return { _tag: 'module-compatibility', reason: 'missing-deployment-id' }

  if (!supportsNativeVercelSkewProtection(context.nitroVersion))
    return { _tag: 'module-compatibility', reason: 'unsupported-nitro' }

  return { _tag: 'nitro-native' }
}
