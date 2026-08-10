interface RollupPluginContext {
  error: (message: string) => never
}

interface RollupInputOptions {
  input?: string | string[] | Record<string, string>
}

interface CloudflareAssetProtectionPlugin {
  name: string
  options: (
    this: RollupPluginContext,
    options: RollupInputOptions,
  ) => RollupInputOptions
  resolveId: (id: string) => string | null
  load: (id: string) => string | null
  buildEnd: (
    this: RollupPluginContext,
    error?: Error,
  ) => void
}

const virtualEntryId = 'virtual:nuxt-skew-protection/cloudflare-entry'
const resolvedVirtualEntryId = `\0${virtualEntryId}`
const nitroPrerendererSuffix = '/nitropack/dist/presets/_nitro/runtime/nitro-prerenderer'
const legacyCloudflareAdapterSuffixes = [
  '/nitropack/dist/runtime/entries/cloudflare-module.mjs',
  '/nitropack/dist/runtime/entries/cloudflare.mjs',
  '/nitropack/dist/runtime/entries/cloudflare-pages.mjs',
]

function isLegacyCloudflareEntry(id: string) {
  const normalizedId = id
    .split('?', 1)[0]!
    .replaceAll('\\', '/')
  return legacyCloudflareAdapterSuffixes.some(suffix => normalizedId.endsWith(suffix))
}

function isNitroPrerendererEntry(id: string) {
  const normalizedId = id
    .split('?', 1)[0]!
    .replaceAll('\\', '/')
  return normalizedId.endsWith(nitroPrerendererSuffix)
    || normalizedId.endsWith(`${nitroPrerendererSuffix}.mjs`)
}

function normalizeBuildAssetsDir(value: string) {
  const path = value.replace(/^\/+|\/+$/g, '')
  return `/${path}/`
}

function renderCloudflareEntry(options: {
  buildAssetsDir: string
  nitroEntryId: string
  runtimeHelperId: string
}) {
  const nitroEntryId = JSON.stringify(options.nitroEntryId)
  const runtimeHelperId = JSON.stringify(options.runtimeHelperId)
  const buildAssetsDir = JSON.stringify(normalizeBuildAssetsDir(options.buildAssetsDir))

  return `import nitroEntry from ${nitroEntryId};
import { fetchCloudflareBuildAsset } from ${runtimeHelperId};
export * from ${nitroEntryId};

if (!nitroEntry || typeof nitroEntry.fetch !== "function") {
  throw new TypeError("[nuxt-skew-protection] Nitro's Cloudflare entry does not expose a fetch handler.");
}

export default {
  ...nitroEntry,
  fetch(request, env, context) {
    const assetResponse = fetchCloudflareBuildAsset(request, env.ASSETS, ${buildAssetsDir});
    return assetResponse ?? nitroEntry.fetch(request, env, context);
  },
};`
}

export function createCloudflareAssetProtectionPlugin(
  options: {
    buildAssetsDir: string
    runtimeHelperId: string
  },
): CloudflareAssetProtectionPlugin {
  let nitroEntryId: string | undefined
  let prerendererBuild = false
  let wrapperLoaded = false

  return {
    name: 'nuxt-skew-protection:cloudflare-asset-fetch',
    options(inputOptions) {
      nitroEntryId = undefined
      prerendererBuild = false
      wrapperLoaded = false

      if (typeof inputOptions.input !== 'string') {
        this.error(
          '[nuxt-skew-protection] Asset 404 protection requires one Nitro entry.',
        )
      }
      if (isNitroPrerendererEntry(inputOptions.input)) {
        prerendererBuild = true
        return inputOptions
      }
      if (isLegacyCloudflareEntry(inputOptions.input)) {
        this.error(
          '[nuxt-skew-protection] Asset 404 protection requires nitropack >= 2.10.0. Your project uses an older adapter without the ASSETS binding. Upgrade nitropack (or nuxt) to enable asset 404 protection.',
        )
      }

      nitroEntryId = inputOptions.input
      return {
        ...inputOptions,
        input: virtualEntryId,
      }
    },
    resolveId(id) {
      return id === virtualEntryId ? resolvedVirtualEntryId : null
    },
    load(id) {
      if (id !== resolvedVirtualEntryId || !nitroEntryId) {
        return null
      }

      wrapperLoaded = true
      return renderCloudflareEntry({
        ...options,
        nitroEntryId,
      })
    },
    buildEnd(error) {
      if (!error && !wrapperLoaded && !prerendererBuild) {
        this.error(
          '[nuxt-skew-protection] Nitro\'s Cloudflare entry was not bundled. Refusing to build without asset 404 protection.',
        )
      }
    },
  }
}
