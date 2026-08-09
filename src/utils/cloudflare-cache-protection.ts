interface TransformCloudflareModuleAdapterOptions {
  buildAssetsDir: string
  code: string
  id: string
  runtimeHelperId: string
}

export type TransformCloudflareModuleAdapterResult
  = | {
    _tag: 'NotCloudflareModuleAdapter'
  }
  | {
    _tag: 'Transformed'
    code: string
  }
  | {
    _tag: 'IncompatibleCloudflareModuleAdapter'
    reason: 'PublicAssetImportNotFound' | 'AssetFetchBranchNotFound' | 'LegacyCloudflareAdapter'
  }

interface RollupPluginContext {
  error: (message: string) => never
}

interface RollupTransformResult {
  code: string
  map: null
}

interface CloudflareAssetProtectionPlugin {
  name: string
  transform: (
    this: RollupPluginContext,
    code: string,
    id: string,
  ) => RollupTransformResult | null
  buildEnd: (
    this: RollupPluginContext,
    error?: Error,
  ) => void
}

const cloudflareAssetAdapterSuffixes = [
  '/nitropack/dist/presets/cloudflare/runtime/cloudflare-module.mjs',
  '/nitropack/dist/presets/cloudflare/runtime/cloudflare-durable.mjs',
]

const legacyCloudflareAdapterSuffixes = [
  '/nitropack/dist/runtime/entries/cloudflare-module.mjs',
  '/nitropack/dist/runtime/entries/cloudflare.mjs',
  '/nitropack/dist/runtime/entries/cloudflare-pages.mjs',
]

const publicAssetImportPattern
  = /import\s*\{\s*isPublicAssetURL\s*\}\s*from\s*["']#nitro-internal-virtual\/public-assets["'];?/

const assetFetchBranchPattern
  = /return\s+env\.ASSETS\.fetch\(\s*request\s*\)\s*;/

function normalizeAdapterId(id: string) {
  return id
    .split('?', 1)[0]!
    .replaceAll('\\', '/')
}

function isCloudflareModuleAdapter(id: string) {
  return cloudflareAssetAdapterSuffixes.some(suffix => normalizeAdapterId(id).endsWith(suffix))
}

function isLegacyCloudflareModuleAdapter(id: string) {
  return legacyCloudflareAdapterSuffixes.some(suffix => normalizeAdapterId(id).endsWith(suffix))
}

function normalizeBuildAssetsDir(value: string) {
  const path = value.replace(/^\/+|\/+$/g, '')
  return `/${path}/`
}

export function transformCloudflareModuleAdapter(
  options: TransformCloudflareModuleAdapterOptions,
): TransformCloudflareModuleAdapterResult {
  if (!isCloudflareModuleAdapter(options.id)) {
    if (isLegacyCloudflareModuleAdapter(options.id)) {
      return {
        _tag: 'IncompatibleCloudflareModuleAdapter',
        reason: 'LegacyCloudflareAdapter',
      }
    }
    return {
      _tag: 'NotCloudflareModuleAdapter',
    }
  }

  if (!publicAssetImportPattern.test(options.code)) {
    return {
      _tag: 'IncompatibleCloudflareModuleAdapter',
      reason: 'PublicAssetImportNotFound',
    }
  }

  if (!assetFetchBranchPattern.test(options.code)) {
    return {
      _tag: 'IncompatibleCloudflareModuleAdapter',
      reason: 'AssetFetchBranchNotFound',
    }
  }

  const helperImport
    = `import { fetchCloudflareAsset } from ${JSON.stringify(options.runtimeHelperId)};`
  const buildAssetsDir = JSON.stringify(normalizeBuildAssetsDir(options.buildAssetsDir))
  const code = options.code
    .replace(
      publicAssetImportPattern,
      match => `${match}\n${helperImport}`,
    )
    .replace(
      assetFetchBranchPattern,
      () => `return url.pathname.startsWith(${buildAssetsDir}) ? fetchCloudflareAsset(request, env.ASSETS) : env.ASSETS.fetch(request);`,
    )

  return {
    _tag: 'Transformed',
    code,
  }
}

export function createCloudflareAssetProtectionPlugin(
  options: {
    buildAssetsDir: string
    runtimeHelperId: string
  },
): CloudflareAssetProtectionPlugin {
  let adapterTransformed = false

  return {
    name: 'nuxt-skew-protection:cloudflare-asset-fetch',
    transform(code, id) {
      const result = transformCloudflareModuleAdapter({
        buildAssetsDir: options.buildAssetsDir,
        code,
        id,
        runtimeHelperId: options.runtimeHelperId,
      })

      if (result._tag === 'NotCloudflareModuleAdapter') {
        return null
      }

      if (result._tag === 'IncompatibleCloudflareModuleAdapter') {
        const message = result.reason === 'LegacyCloudflareAdapter'
          ? `[nuxt-skew-protection] Asset 404 protection requires nitropack >= 2.10.0. Your project uses an older nitropack whose cloudflare-module adapter serves assets via getAssetFromKV, which cannot be protected. Upgrade nitropack (or nuxt) to enable asset 404 protection.`
          : `[nuxt-skew-protection] Nitro's cloudflare-module adapter is incompatible with asset 404 protection (${result.reason}).`
        this.error(message)
      }

      adapterTransformed = true
      return {
        code: result.code,
        map: null,
      }
    },
    buildEnd(error) {
      if (!error && !adapterTransformed) {
        this.error(
          `[nuxt-skew-protection] Nitro's cloudflare-module adapter was not bundled. Refusing to build without asset 404 protection.`,
        )
      }
    },
  }
}
