import type { Storage } from 'unstorage'
import { promises as fs } from 'node:fs'
import { createConsola } from 'consola'
import { colors } from 'consola/utils'
import { dirname, join } from 'pathe'
import { createStorage } from 'unstorage'
import fsDriver from 'unstorage/drivers/fs'

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
    // Chunks deleted in this version compared to previous version
    deletedChunks?: string[]
  }>
  // Cloudflare-specific: maps asset paths to deployment IDs for fast lookup
  assetToDeployment?: Record<string, string>
  // Generic-specific: maps deployment IDs to version IDs
  deploymentMapping?: Record<string, string>
  // Maps file IDs (hashes from filename) to the latest version that contains them
  fileIdToVersion?: Record<string, string>
}

export const CURRENT_VERSION_ID = 'current'

/**
 * Extract file ID (hash + extension) from asset path
 * Assumes format like: /_nuxt/ABC123.js or /_nuxt/ABC123.DEF456.js
 * Returns the first segment including extension (e.g., "ABC123.js")
 */
function extractFileId(assetPath: string): string | null {
  const filename = assetPath.split('/').pop()
  if (!filename)
    return null

  // Extract the first hash segment with its extension (e.g., "ABC123.js" from "ABC123.DEF456.js")
  const match = filename.match(/^([^.]+\.\w+)/)
  return match ? match[1] ?? null : null
}

/**
 * Calculate deleted chunks in the current version compared to a previous version
 */
export function calculateDeletedChunks(currentAssets: string[], previousAssets: string[]): string[] {
  const currentSet = new Set(currentAssets)
  return previousAssets.filter(asset => !currentSet.has(asset))
}

/**
 * Get the previous version by timestamp
 */
export function getPreviousVersion(manifest: VersionManifest, currentVersionId: string): string | null {
  const sortedVersions = Object.entries(manifest.versions)
    .map(([id, data]) => ({ id, timestamp: new Date(data.timestamp).getTime() }))
    .sort((a, b) => b.timestamp - a.timestamp)

  const currentIndex = sortedVersions.findIndex(v => v.id === currentVersionId)
  if (currentIndex === -1 || currentIndex === sortedVersions.length - 1) {
    return null
  }

  return sortedVersions[currentIndex + 1]?.id || null
}

/**
 * Check if client's loaded chunks intersect with deleted chunks from an update
 * Returns true if update is urgent (client is using deleted chunks)
 */
export function isUpdateUrgent(
  clientChunks: string[],
  deletedChunksInUpdate: string[],
): boolean {
  const deletedChunksSet = new Set(deletedChunksInUpdate)
  return clientChunks.some(chunk => deletedChunksSet.has(chunk))
}

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
  const store = storage
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
  const store = storage
  await store.setItem('version-manifest.json', manifest)
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

  async function getAssetsFromBuild(buildId: string, outputDir: string) {
    const nuxtDir = join(outputDir, 'public', '_nuxt')

    const assets: string[] = []
    const nuxtFiles = await getFilesRecursively(nuxtDir)

    for (const file of nuxtFiles) {
      const relativePath = file.replace(nuxtDir, '')
      assets.push(`_nuxt${relativePath}`)
    }

    return assets
  }

  async function updateVersionsManifest(buildId: string, assets: string[]) {
    const now = new Date()
    const expires = new Date(now.getTime() + (retentionDays * 24 * 60 * 60 * 1000))

    const manifest = await getVersionManifest(storage)

    // Check if this version already exists (for skipping restoration later)
    const isExistingVersion = !!manifest.versions[buildId]

    manifest.current = buildId
    manifest.versions[buildId] = {
      timestamp: now.toISOString(),
      expires: expires.toISOString(),
      assets,
      // deletedChunks will be calculated after deduplication in storeAssetsInStorage
      deletedChunks: [],
    }

    await setVersionManifest(manifest, storage)

    return { manifest, isExistingVersion }
  }

  async function cleanupExpiredVersions(_outputDir: string) {
    const manifest = await getVersionManifest(storage)
    if (!manifest || !manifest.versions) {
      return
    }

    const now = new Date()
    const removedVersions: Array<{ id: string, reason: string, assetCount: number }> = []

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
        // Remove assets from storage
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

        // Clean up fileIdToVersion mapping if it exists
        if (manifest.fileIdToVersion) {
          for (const [fileId, versionId] of Object.entries(manifest.fileIdToVersion)) {
            if (versionId === version.id) {
              delete manifest.fileIdToVersion[fileId]
            }
          }
        }

        removedVersions.push({
          id: version.id,
          reason: isExpired ? 'expired' : 'exceeded count limit',
          assetCount: version.assets.length,
        })
      }
    }

    if (removedVersions.length > 0) {
      await setVersionManifest(manifest, storage)

      logger.log(`Removing outdated build artifacts...`)
      removedVersions.forEach((item, index) => {
        const isLast = index === removedVersions.length - 1
        const prefix = isLast ? '  └─' : '  ├─'
        const versionInfo = `${item.id.slice(0, 8)}`
        const assetInfo = `(${item.assetCount} asset${item.assetCount > 1 ? 's' : ''})`
        const reasonInfo = `[${item.reason}]`

        logger.log(colors.gray(`${prefix} ${versionInfo} ${assetInfo} ${reasonInfo}`))
      })
    }
  }

  async function storeAssetsInStorage(buildId: string, outputDir: string, assets: string[]) {
    const publicDir = join(outputDir, 'public')
    const manifest = await getVersionManifest(storage)

    // Initialize fileIdToVersion map if it doesn't exist
    if (!manifest.fileIdToVersion) {
      manifest.fileIdToVersion = {}
    }

    const fileIdToVersion = manifest.fileIdToVersion

    // Calculate deletedChunks BEFORE deduplication, comparing current assets vs previous version's current state
    const currentVersion = manifest.versions[buildId]
    if (currentVersion) {
      const previousVersionId = getPreviousVersion(manifest, buildId)
      const previousAssets = previousVersionId ? manifest.versions[previousVersionId]?.assets || [] : []
      currentVersion.deletedChunks = calculateDeletedChunks(assets, previousAssets)
    }

    for (const asset of assets) {
      const fileId = extractFileId(asset)

      // Store the file in current build's storage
      const assetPath = join(publicDir, asset)
      const assetData = await fs.readFile(assetPath).catch((error) => {
        if (options.debug) {
          logger.warn(`Failed to read ${assetPath}:`, error)
        }
        return null
      })

      if (assetData) {
        const storageKey = `${buildId}/${asset}`
        await storage.setItemRaw(storageKey, assetData).catch((error) => {
          if (options.debug) {
            logger.warn(`Failed to store ${storageKey}:`, error)
          }
        })

        // Check if this file ID already exists in a previous version
        // If so, remove it from the old location since we now have it in the new location
        if (fileId && fileIdToVersion[fileId] && fileIdToVersion[fileId] !== buildId) {
          const previousVersionId = fileIdToVersion[fileId]

          // Remove the asset from the previous version's assets list
          if (manifest.versions[previousVersionId]) {
            const previousAssets = manifest.versions[previousVersionId].assets
            const assetIndex = previousAssets.findIndex(a => extractFileId(a) === fileId)
            if (assetIndex !== -1) {
              previousAssets.splice(assetIndex, 1)

              // Remove from storage
              const oldStorageKey = `${previousVersionId}/${asset}`
              await storage.removeItem(oldStorageKey).catch((error) => {
                if (options.debug) {
                  logger.warn(`Failed to remove duplicate asset ${oldStorageKey}:`, error)
                }
              })
            }
          }
        }

        // Update the file ID mapping to point to the current version
        if (fileId) {
          fileIdToVersion[fileId] = buildId
        }
      }
    }

    // Save updated manifest with fileIdToVersion mapping
    await setVersionManifest(manifest, storage)
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

  async function restoreOldAssetsToPublic(currentBuildId: string, outputDir: string, currentAssets: string[] = [], isExistingVersion = false) {
    const manifest = await getVersionManifest(storage)

    if (!manifest || !manifest.versions) {
      return
    }

    // If this build ID already existed before this build, no need to restore
    // because the assets are already in place
    if (isExistingVersion) {
      if (options.debug) {
        logger.info(`Build ID ${currentBuildId} already exists, skipping restore`)
      }
      return
    }

    const publicDir = join(outputDir, 'public')
    const restoredAssets: Array<{ asset: string, size: number, versionId: string, age: string }> = []
    const currentAssetsSet = new Set(currentAssets)

    // Build a set of file IDs from current assets to skip duplicates
    const currentFileIds = new Set<string>()
    for (const asset of currentAssets) {
      const fileId = extractFileId(asset)
      if (fileId) {
        currentFileIds.add(fileId)
      }
    }

    const now = Date.now()

    for (const [versionId, versionData] of Object.entries(manifest.versions)) {
      if (versionId === currentBuildId) {
        continue
      }

      const assets = versionData.assets
      for (const asset of assets) {
        // Skip if this asset path is already in the current version
        if (currentAssetsSet.has(asset)) {
          continue
        }

        // Skip if a file with the same file ID exists in current version
        const fileId = extractFileId(asset)
        if (fileId && currentFileIds.has(fileId)) {
          continue
        }

        const storageKey = `${versionId}/${asset}`
        await storage.getItemRaw(storageKey)
          .then(async (assetData) => {
            if (assetData) {
              const targetPath = join(publicDir, asset)
              await fs.mkdir(dirname(targetPath), { recursive: true })

              // Ensure we write Buffer data directly without JSON serialization
              let dataToWrite: Buffer
              if (Buffer.isBuffer(assetData)) {
                dataToWrite = assetData
              }
              else if (typeof assetData === 'object' && assetData.type === 'Buffer' && Array.isArray(assetData.data)) {
                // Handle serialized Buffer format from storage
                dataToWrite = Buffer.from(assetData.data)
              }
              else {
                dataToWrite = Buffer.from(assetData)
              }
              await fs.writeFile(targetPath, dataToWrite)

              // Calculate time ago
              const versionTimestamp = new Date(versionData.timestamp).getTime()
              const ageMs = now - versionTimestamp
              const ageMinutes = Math.floor(ageMs / 60000)
              const ageHours = Math.floor(ageMinutes / 60)
              const ageDays = Math.floor(ageHours / 24)

              let ageStr: string
              if (ageDays > 0) {
                ageStr = `${ageDays}d ago`
              }
              else if (ageHours > 0) {
                ageStr = `${ageHours}h ago`
              }
              else if (ageMinutes > 0) {
                ageStr = `${ageMinutes}m ago`
              }
              else {
                ageStr = 'just now'
              }

              restoredAssets.push({
                asset,
                size: dataToWrite.byteLength,
                versionId,
                age: ageStr,
              })
            }
          })
          .catch((error) => {
            if (options.debug) {
              logger.warn(`Failed to restore asset ${asset} from version ${versionId}:`, error)
            }
          })
      }
    }

    if (restoredAssets.length > 0) {
      restoredAssets.forEach((item, index) => {
        const isLast = index === restoredAssets.length - 1
        const prefix = isLast ? '  └─' : '  ├─'
        const sizeKB = (item.size / 1024).toFixed(2)
        const displayPath = `public/${item.asset}`
        const sizeInfo = `(${sizeKB} kB)`
        const versionInfo = `[${item.versionId.slice(0, 8)}]`
        const ageInfo = `(${item.age})`

        logger.log(colors.gray(`${prefix} ${displayPath} ${sizeInfo} ${versionInfo} ${ageInfo}`))
      })
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
  async function augmentBuildMetadata(buildId: string, outputDir: string) {
    const manifest = await getVersionManifest(storage)

    // Augment builds/latest.json
    const latestPath = join(outputDir, 'public', '_nuxt', 'builds', 'latest.json')
    try {
      const latestData = await fs.readFile(latestPath, 'utf-8')
      const latestJson = JSON.parse(latestData)

      latestJson.skewProtection = {
        versions: manifest.versions,
        deploymentMapping: manifest.deploymentMapping,
      }

      await fs.writeFile(latestPath, JSON.stringify(latestJson, null, 2), 'utf-8')
    }
    catch (error) {
      if (options.debug) {
        logger.warn('Failed to augment builds/latest.json:', error)
      }
    }

    // Augment builds/meta/{buildId}.json
    const metaPath = join(outputDir, 'public', '_nuxt', 'builds', 'meta', `${buildId}.json`)
    try {
      const metaData = await fs.readFile(metaPath, 'utf-8')
      const metaJson = JSON.parse(metaData)

      const versionData = manifest.versions[buildId]
      if (versionData) {
        metaJson.skewProtection = {
          assets: versionData.assets,
          deletedChunks: versionData.deletedChunks,
          timestamp: versionData.timestamp,
          expires: versionData.expires,
        }
      }

      await fs.writeFile(metaPath, JSON.stringify(metaJson, null, 2), 'utf-8')
    }
    catch (error) {
      if (options.debug) {
        logger.warn(`Failed to augment builds/meta/${buildId}.json:`, error)
      }
    }
  }

  return {
    getAssetsFromBuild,
    updateVersionsManifest,
    cleanupExpiredVersions,
    storeAssetsInStorage,
    listExistingVersions,
    restoreOldAssetsToPublic,
    updateDeploymentMapping,
    getVersionForDeployment,
    augmentBuildMetadata,
  }
}
