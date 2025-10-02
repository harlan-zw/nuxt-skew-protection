import type { Storage } from 'unstorage'
import { promises as fs } from 'node:fs'
import { createConsola } from 'consola'
import { dirname, join } from 'pathe'
import { createStorage } from 'unstorage'
import fsDriver from 'unstorage/drivers/fs'
import { getSkewProtectionStorage } from './storage'

const logger = createConsola({
  defaults: { tag: 'nuxt-skew-protection' },
})

// Unified manifest format used by all platforms
export interface VersionManifest {
  current: string
  versions: Record<string, {
    timestamp: string
    expires: string
    deploymentId?: string
    assets: string[]
  }>
  // Cloudflare-specific: maps asset paths to deployment IDs for fast lookup
  assetToDeployment?: Record<string, string>
  // Generic-specific: maps deployment IDs to version IDs
  deploymentMapping?: Record<string, string>
}

export const CURRENT_VERSION_ID = 'current'

async function getFilesRecursively(dir: string): Promise<string[]> {
  const files: string[] = []
  const items = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])

  for (const item of items) {
    const fullPath = join(dir, item.name)
    if (item.isDirectory()) {
      const subFiles = await getFilesRecursively(fullPath)
      files.push(...subFiles)
    }
    else {
      files.push(fullPath)
    }
  }

  return files
}

// Get the unified manifest
export async function getVersionManifest(storage?: Storage): Promise<VersionManifest> {
  const store = storage || getSkewProtectionStorage()
  return store.getItem('version-manifest.json')
    .then(manifest => (manifest as VersionManifest) || {
      current: '',
      versions: {},
    })
    .catch(() => ({
      current: '',
      versions: {},
    }))
}

// Update the manifest
async function setVersionManifest(manifest: VersionManifest, storage?: Storage): Promise<void> {
  const store = storage || getSkewProtectionStorage()
  await store.setItem('version-manifest.json', manifest)
}

// ============================================================================
// CLOUDFLARE-SPECIFIC: Asset manifest generation (no copying/storage)
// ============================================================================

export async function generateCloudflareManifest(
  deploymentId: string,
  buildId: string,
  outputDir: string,
  buildAssetsDir = '/_nuxt',
  options?: { debug?: boolean },
): Promise<VersionManifest> {
  const storage = getSkewProtectionStorage()
  const manifest = await getVersionManifest(storage)

  // Find all build assets in the output directory
  const assetsSubDir = buildAssetsDir.replace(/^\//, '')
  const assetsOutputDir = join(outputDir, 'public', assetsSubDir)
  const assetFiles: string[] = []
  const assetToDeployment: Record<string, string> = manifest.assetToDeployment || {}

  await fs.readdir(assetsOutputDir, { recursive: true })
    .then((files) => {
      for (const file of files) {
        if (typeof file === 'string') {
          const assetPath = `${buildAssetsDir}/${file}`
          assetFiles.push(assetPath)
          assetToDeployment[assetPath] = deploymentId
        }
      }
    })
    .catch((error) => {
      if (options?.debug) {
        logger.warn('Could not read build assets directory:', error)
      }
    })

  // Add this version to the manifest
  const now = new Date()
  const expires = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000)) // 7 days default

  manifest.current = buildId
  manifest.versions[buildId] = {
    timestamp: now.toISOString(),
    expires: expires.toISOString(),
    deploymentId,
    assets: assetFiles,
  }
  manifest.assetToDeployment = assetToDeployment

  // Keep only the last 10 releases for Cloudflare
  const maxReleases = 10
  const sortedVersions = Object.entries(manifest.versions)
    .map(([id, data]) => ({ id, timestamp: new Date(data.timestamp).getTime() }))
    .sort((a, b) => b.timestamp - a.timestamp)

  if (sortedVersions.length > maxReleases) {
    const removed = sortedVersions.slice(maxReleases)
    for (const { id } of removed) {
      const versionAssets = manifest.versions[id]?.assets || []
      delete manifest.versions[id]

      // Clean up asset mappings
      if (manifest.assetToDeployment) {
        for (const asset of versionAssets) {
          if (manifest.assetToDeployment[asset] === manifest.versions[id]?.deploymentId) {
            delete manifest.assetToDeployment[asset]
          }
        }
      }
    }
  }

  await setVersionManifest(manifest, storage)

  if (options?.debug) {
    logger.info(`Generated Cloudflare manifest with ${assetFiles.length} assets`)
  }

  return manifest
}

// Get deployment ID for a specific asset (Cloudflare)
export async function getAssetDeploymentId(assetPath: string): Promise<string | null> {
  const manifest = await getVersionManifest()
  return manifest.assetToDeployment?.[assetPath] || null
}

// ============================================================================
// GENERIC PLATFORM: Full asset versioning with copy/storage
// ============================================================================

export function createAssetManager(options: {
  storage?: any
  retentionDays?: number
  maxNumberOfVersions?: number
  debug?: boolean
}) {
  // Create storage with proper driver
  let storage: Storage
  if (options.storage?.driver === 'fs') {
    storage = createStorage({
      driver: fsDriver(options.storage),
    })
  }
  else {
    storage = options.storage ? createStorage(options.storage) : createStorage()
  }

  const retentionDays = options.retentionDays || 7
  const maxNumberOfVersions = options.maxNumberOfVersions || 20

  async function copyAssetsToVersionedDirectory(buildId: string, outputDir: string) {
    const versionDir = join(outputDir, 'public', '_versions', buildId)
    const nuxtDir = join(outputDir, 'public', '_nuxt')

    await fs.mkdir(versionDir, { recursive: true })

    const assets: string[] = []
    const nuxtFiles = await getFilesRecursively(nuxtDir)

    for (const file of nuxtFiles) {
      const relativePath = file.replace(nuxtDir, '')
      const destPath = join(versionDir, '_nuxt', relativePath)
      const destDir = dirname(destPath)

      await fs.mkdir(destDir, { recursive: true })
      await fs.copyFile(file, destPath).catch((error) => {
        if (options.debug) {
          logger.warn(`Failed to copy ${file}:`, error)
        }
      })

      assets.push(`_nuxt${relativePath}`)
    }

    if (options.debug) {
      logger.info(`Copied ${assets.length} assets for version ${buildId}`)
    }

    return assets
  }

  async function updateVersionsManifest(buildId: string, assets: string[]) {
    const now = new Date()
    const expires = new Date(now.getTime() + (retentionDays * 24 * 60 * 60 * 1000))

    const manifest = await getVersionManifest(storage)

    manifest.current = buildId
    manifest.versions[buildId] = {
      timestamp: now.toISOString(),
      expires: expires.toISOString(),
      assets,
    }

    await setVersionManifest(manifest, storage)

    if (options.debug) {
      logger.info(`Updated manifest with version ${buildId}`)
    }

    return manifest
  }

  async function cleanupExpiredVersions(outputDir: string) {
    const manifest = await getVersionManifest(storage)
    if (!manifest || !manifest.versions) {
      return
    }

    const now = new Date()
    const versionsDir = join(outputDir, 'public', '_versions')
    let cleanedCount = 0

    const sortedVersions = Object.entries(manifest.versions)
      .map(([id, data]) => ({ id, ...data, timestamp: new Date(data.timestamp).getTime() }))
      .sort((a, b) => b.timestamp - a.timestamp)

    const maxAge = retentionDays * 24 * 60 * 60 * 1000

    for (let i = 0; i < sortedVersions.length; i++) {
      const version = sortedVersions[i]!
      const isExpired = (now.getTime() - version.timestamp) > maxAge
      const exceedsCount = i >= maxNumberOfVersions
      const isCurrent = version.id === manifest.current

      if (isCurrent || (i === 0 && sortedVersions.length === 1)) {
        continue
      }

      if (isExpired || exceedsCount) {
        const versionPath = join(versionsDir, version.id)
        await fs.rm(versionPath, { recursive: true, force: true }).catch((error) => {
          if (options.debug) {
            logger.warn(`Failed to remove ${versionPath}:`, error)
          }
        })

        const assetPromises = version.assets.map(asset =>
          storage.removeItem(`${version.id}/${asset}`).catch((error) => {
            if (options.debug) {
              logger.warn(`Failed to remove asset ${asset}:`, error)
            }
          }),
        )
        await Promise.all(assetPromises)

        delete manifest.versions[version.id]

        // Clean up deployment mapping if it exists
        if (manifest.deploymentMapping) {
          for (const [deploymentId, versionId] of Object.entries(manifest.deploymentMapping)) {
            if (versionId === version.id) {
              delete manifest.deploymentMapping[deploymentId]
            }
          }
        }

        cleanedCount++

        if (options.debug) {
          logger.info(`Removed version ${version.id} (${isExpired ? 'expired' : 'exceeded count limit'})`)
        }
      }
    }

    if (cleanedCount > 0) {
      await setVersionManifest(manifest, storage)
      if (options.debug) {
        logger.info(`Cleaned up ${cleanedCount} versions`)
      }
    }
  }

  async function storeAssetsInStorage(buildId: string, outputDir: string, assets: string[]) {
    const versionDir = join(outputDir, 'public', '_versions', buildId)

    for (const asset of assets) {
      const assetPath = join(versionDir, asset)
      const assetData = await fs.readFile(assetPath).catch((error) => {
        if (options.debug) {
          logger.warn(`Failed to read ${assetPath}:`, error)
        }
        return null
      })

      if (assetData) {
        const storageKey = `${buildId}/${asset}`
        await storage.setItem(storageKey, assetData).catch((error) => {
          if (options.debug) {
            logger.warn(`Failed to store ${storageKey}:`, error)
          }
        })
      }
    }

    if (options.debug) {
      logger.info(`Stored ${assets.length} assets in storage for version ${buildId}`)
    }
  }

  async function listExistingVersions(): Promise<{ id: string, createdAt: number }[]> {
    const manifest = await getVersionManifest(storage)
    if (!manifest) {
      return []
    }

    return Object.entries(manifest.versions).map(([id, data]) => ({
      id,
      createdAt: new Date(data.timestamp).getTime(),
    }))
  }

  async function restoreOldAssetsToPublic(currentBuildId: string, outputDir: string) {
    const manifest = await getVersionManifest(storage)

    if (!manifest || !manifest.versions) {
      return
    }

    const publicDir = join(outputDir, 'public')
    let restoredCount = 0

    for (const [versionId, versionData] of Object.entries(manifest.versions)) {
      if (versionId === currentBuildId) {
        continue
      }

      const assets = versionData.assets
      for (const asset of assets) {
        const storageKey = `${versionId}/${asset}`
        await storage.getItemRaw(storageKey)
          .then(async (assetData) => {
            if (assetData) {
              const targetPath = join(publicDir, asset)
              await fs.mkdir(dirname(targetPath), { recursive: true })
              await fs.writeFile(targetPath, assetData)
              restoredCount++
            }
          })
          .catch((error) => {
            if (options.debug) {
              logger.warn(`Failed to restore asset ${asset} from version ${versionId}:`, error)
            }
          })
      }
    }

    if (options.debug && restoredCount > 0) {
      logger.info(`Restored ${restoredCount} old assets to public directory`)
    }
  }

  async function updateDeploymentMapping(
    newDeploymentId: string,
    existingVersions: { id: string, createdAt: number }[],
  ): Promise<void> {
    const manifest = await getVersionManifest(storage)

    // Initialize deployment mapping if it doesn't exist
    if (!manifest.deploymentMapping) {
      manifest.deploymentMapping = {}
    }

    const newMapping: Record<string, string> = { [newDeploymentId]: CURRENT_VERSION_ID }

    const sortedVersions = existingVersions
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, maxNumberOfVersions)

    const versionIds = new Set(sortedVersions.map(v => v.id))

    for (const [deploymentId, versionId] of Object.entries(manifest.deploymentMapping)) {
      if (versionId === CURRENT_VERSION_ID && sortedVersions.length > 0) {
        newMapping[deploymentId] = sortedVersions[0]!.id
      }
      else if (versionIds.has(versionId)) {
        newMapping[deploymentId] = versionId
      }
    }

    manifest.deploymentMapping = newMapping
    await setVersionManifest(manifest, storage)
  }

  async function getVersionForDeployment(deploymentId: string): Promise<string | null> {
    const manifest = await getVersionManifest(storage)
    return manifest.deploymentMapping?.[deploymentId] || null
  }

  async function isDeploymentIdUsed(deploymentId: string): Promise<boolean> {
    const manifest = await getVersionManifest(storage)
    return !!(manifest.deploymentMapping && deploymentId in manifest.deploymentMapping)
  }

  return {
    copyAssetsToVersionedDirectory,
    updateVersionsManifest,
    cleanupExpiredVersions,
    storeAssetsInStorage,
    listExistingVersions,
    restoreOldAssetsToPublic,
    updateDeploymentMapping,
    getVersionForDeployment,
    isDeploymentIdUsed,
  }
}
