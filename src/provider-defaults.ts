export interface BundleAssetsOptions {
  bundleAssets?: boolean
}

export type BundleAssetsResolution
  = | { _tag: 'configured', bundleAssets: boolean }
    | { _tag: 'vercel-native', bundleAssets: false }
    | { _tag: 'default', bundleAssets: true }

export function resolveBundleAssets(
  options: BundleAssetsOptions,
  env: Readonly<Record<string, string | undefined>> = process.env,
): BundleAssetsResolution {
  if (typeof options.bundleAssets === 'boolean') {
    return {
      _tag: 'configured',
      bundleAssets: options.bundleAssets,
    }
  }

  if (env.VERCEL_SKEW_PROTECTION_ENABLED === '1' && env.VERCEL_DEPLOYMENT_ID) {
    return {
      _tag: 'vercel-native',
      bundleAssets: false,
    }
  }

  return {
    _tag: 'default',
    bundleAssets: true,
  }
}
