export interface AssetHandlingOptions {
  bundleAssets?: boolean
  bundlePreviousDeploymentChunks?: boolean
}

export type BundleAssetsResolution
  = | { _tag: 'configured', bundleAssets: boolean }
    | { _tag: 'provider-default', provider: 'vercel', bundleAssets: false }
    | { _tag: 'module-default', bundleAssets: boolean }

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

  if (env.VERCEL_SKEW_PROTECTION_ENABLED === '1') {
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
