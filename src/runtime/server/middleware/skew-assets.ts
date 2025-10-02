import { defineEventHandler } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { getSkewProtectionStorage } from '../../../utils/storage'
import { getVersionManifest } from '../../../utils/version-manager'
import { logger } from '../logger'

/**
 * Middleware for build assets (default: /_nuxt)
 * If the asset isn't found normally, search through all versioned assets
 * No cookie checks needed - if we're here, the asset wasn't found in current version
 */
export default defineEventHandler(async (event) => {
  const url = event.node.req.url || ''

  const buildAssetsDir = useRuntimeConfig().app.buildAssetsDir
  logger.debug(`Checking asset: ${url} (build dir: ${buildAssetsDir})`)

  // Only handle build assets
  if (!url.startsWith(buildAssetsDir)) {
    return
  }

  const assetPath = url.replace(new RegExp(`^${buildAssetsDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), '')
  const storage = getSkewProtectionStorage()

  // Get manifest to find all available versions
  const manifest = await getVersionManifest(storage)

  if (!manifest || !manifest.versions) {
    return
  }

  // Search through all versions for this asset (newest first)
  const versions = Object.keys(manifest.versions).reverse()

  for (const version of versions) {
    const versionedAsset = `${version}/${assetPath}`
    const assetExists = await storage.getItemRaw(versionedAsset).catch(() => null)

    if (assetExists) {
      // Found the asset in this version - rewrite URL
      event.node.req.url = `/_skew/versions/${versionedAsset}`
      logger.debug(`Asset found in version ${version}: ${assetPath}`)
      return
    }
  }

  // Asset not found in any version - let it 404 naturally
})
