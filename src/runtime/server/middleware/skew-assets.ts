import { defineEventHandler } from 'h3'
import { getSkewProtectionStorage } from '../utils/storage'

/**
 * Middleware for /_nuxt assets
 * If the asset isn't found normally, search through all versioned assets
 * No cookie checks needed - if we're here, the asset wasn't found in current version
 */
export default defineEventHandler(async (event) => {
  const url = event.node.req.url || ''

  // Only handle /_nuxt assets
  if (!url.startsWith('/_nuxt/')) {
    return
  }

  const assetPath = url.replace(/^\/_nuxt\//, '')
  const storage = getSkewProtectionStorage()

  // Get manifest to find all available versions
  const manifest = await storage.getItem('versions-manifest.json').catch(() => null) as any

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
      console.log(`[skew-protection] Asset found in version ${version}: ${assetPath}`)
      return
    }
  }

  // Asset not found in any version - let it 404 naturally
})
