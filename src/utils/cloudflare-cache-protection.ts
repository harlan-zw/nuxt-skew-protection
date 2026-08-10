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
const legacyCloudflareAdapterSuffixes = [
  '/nitropack/dist/runtime/entries/cloudflare-module.mjs',
  '/nitropack/dist/runtime/entries/cloudflare.mjs',
  '/nitropack/dist/runtime/entries/cloudflare-pages.mjs',
]
const nitroPrerenderEntrySuffix = '/nitropack/dist/presets/_nitro/runtime/nitro-prerenderer'

function isNitroPrerenderEntry(id: string) {
  const normalizedId = id
    .split('?', 1)[0]!
    .replaceAll('\\', '/')
  return normalizedId.endsWith(nitroPrerenderEntrySuffix)
    || normalizedId.endsWith(`${nitroPrerenderEntrySuffix}.mjs`)
}

function isLegacyCloudflareEntry(id: string) {
  const normalizedId = id
    .split('?', 1)[0]!
    .replaceAll('\\', '/')
  return legacyCloudflareAdapterSuffixes.some(suffix => normalizedId.endsWith(suffix))
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
  let wrapperLoaded = false
  let shouldWrapEntry = true

  return {
    name: 'nuxt-skew-protection:cloudflare-asset-fetch',
    options(inputOptions) {
      nitroEntryId = undefined
      wrapperLoaded = false
      shouldWrapEntry = false

      if (typeof inputOptions.input !== 'string') {
        this.error(
          '[nuxt-skew-protection] Asset 404 protection requires one Nitro entry.',
        )
      }
      if (isNitroPrerenderEntry(inputOptions.input)) {
        return inputOptions
      }
      if (isLegacyCloudflareEntry(inputOptions.input)) {
        this.error(
          '[nuxt-skew-protection] Asset 404 protection requires nitropack >= 2.10.0. Your project uses an older adapter without the ASSETS binding. Upgrade nitropack (or nuxt) to enable asset 404 protection.',
        )
      }

      nitroEntryId = inputOptions.input
      shouldWrapEntry = true
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
      if (shouldWrapEntry && !error && !wrapperLoaded) {
        this.error(
          '[nuxt-skew-protection] Nitro\'s Cloudflare entry was not bundled. Refusing to build without asset 404 protection.',
        )
      }
    },
  }
}
