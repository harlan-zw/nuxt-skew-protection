import type { Driver, Storage } from 'unstorage'
import { promises as fs } from 'node:fs'
import { colors } from 'consola/utils'
import { dirname, join } from 'pathe'
import { createStorage } from 'unstorage'
import { logger } from '../logger'

/**
 * Process array items in batches to limit memory usage
 */
async function processBatch<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map(processor))
    results.push(...batchResults)
  }
  return results
}

// Unified manifest format used by all platforms
export interface VersionManifest {
  current: string
  versions: Record<string, {
    timestamp: string
    expires: string
    assets: string[]
    // Chunks deleted in this version compared to previous version
    deletedChunks?: string[]
  }>
  // Maps file IDs (hashes from filename) to the latest version that contains them
  fileIdToVersion?: Record<string, string>
}

/**
 * Extract file ID from asset path
 * Returns the filename (e.g., "entry.BBOLE4X7.js" from "_nuxt/entry.BBOLE4X7.js")
 * Used for deduplication - same filename = same content (Nuxt uses content hashing)
 */
export function extractFileId(assetPath: string): string | null {
  const filename = assetPath.split('/').pop()
  if (!filename || !filename.includes('.'))
    return null

  return filename
}

/**
 * Calculate deleted chunks in the current version compared to a previous version
 * Only includes .js files since CSS files are not tracked by the service worker
 */
function calculateDeletedChunks(currentAssets: string[], previousAssets: string[]): string[] {
  const currentSet = new Set(currentAssets)
  return previousAssets
    .filter(asset => !currentSet.has(asset))
    .filter(asset => asset.endsWith('.js'))
}

/**
 * Get the previous version by timestamp
 */
function getPreviousVersion(manifest: VersionManifest, currentVersionId: string): string | null {
  const sortedVersions = Object.entries(manifest.versions)
    .map(([id, data]) => ({ id, timestamp: new Date(data.timestamp).getTime() }))
    .sort((a, b) => b.timestamp - a.timestamp)

  const currentIndex = sortedVersions.findIndex(v => v.id === currentVersionId)
  if (currentIndex === -1 || currentIndex === sortedVersions.length - 1) {
    return null
  }

  return sortedVersions[currentIndex + 1]?.id || null
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
async function getVersionManifest(storage: Storage): Promise<VersionManifest> {
  try {
    const manifest = await storage.getItem('version-manifest.json')

    // Ensure we have a valid manifest structure
    if (manifest && typeof manifest === 'object' && 'versions' in manifest) {
      return manifest as VersionManifest
    }

    // Return default manifest if invalid or missing
    return {
      current: '',
      versions: {},
    }
  }
  catch {
    return {
      current: '',
      versions: {},
    }
  }
}

// Update the manifest
async function setVersionManifest(manifest: VersionManifest, storage: Storage): Promise<void> {
  await storage.setItem('version-manifest.json', manifest)
}

// ============================================================================
// ASSET MANAGER: Full asset versioning with copy/storage
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024)
    return `${bytes}B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function formatDuration(ms: number): string {
  if (ms < 1000)
    return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function createAssetManager(options: {
  driver?: Driver
  retentionDays?: number
  maxNumberOfVersions?: number
  debug?: boolean
}) {
  // Create storage with proper driver
  const storage: Storage = createStorage({
    driver: options.driver,
  })
  const retentionDays = options.retentionDays || 7
  const maxNumberOfVersions = options.maxNumberOfVersions || 20

  async function getAssetsFromBuild(outputDir: string) {
    const startTime = Date.now()
    const nuxtDir = join(outputDir, 'public', '_nuxt')

    logger.debug(`Scanning build assets from ${nuxtDir}`)

    const assets: string[] = []
    const nuxtFiles = await getFilesRecursively(nuxtDir)

    for (const file of nuxtFiles) {
      const relativePath = file.replace(nuxtDir, '')
      assets.push(`_nuxt${relativePath}`)
    }

    logger.debug(`Found ${assets.length} assets in ${formatDuration(Date.now() - startTime)}`)
    return assets
  }

  async function updateVersionsManifest(buildId: string, assets: string[]) {
    const startTime = Date.now()
    logger.debug(`updateVersionsManifest: starting for ${buildId}`)

    const now = new Date()
    const expires = new Date(now.getTime() + (retentionDays * 24 * 60 * 60 * 1000))

    const manifestStart = Date.now()
    const manifest = await getVersionManifest(storage)
    logger.debug(`updateVersionsManifest: loaded manifest in ${formatDuration(Date.now() - manifestStart)} (${Object.keys(manifest.versions).length} versions)`)

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

    const saveStart = Date.now()
    await setVersionManifest(manifest, storage)
    logger.debug(`updateVersionsManifest: saved manifest in ${formatDuration(Date.now() - saveStart)}`)
    logger.debug(`updateVersionsManifest: total ${formatDuration(Date.now() - startTime)}`)

    return { manifest, isExistingVersion }
  }

  async function cleanupExpiredVersions() {
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
        // Remove assets from storage in batches to limit memory
        await processBatch(version.assets, 50, async (asset) => {
          await storage.removeItem(`${version.id}/${asset}`).catch((error) => {
            if (options.debug) {
              logger.warn(`Failed to remove asset ${asset}:`, error)
            }
          })
        })

        delete manifest.versions[version.id]

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

    // Final pruning: remove any orphaned fileId entries referencing non-existent versions
    if (manifest.fileIdToVersion) {
      const validVersionIds = new Set(Object.keys(manifest.versions))
      let prunedCount = 0
      for (const [fileId, versionId] of Object.entries(manifest.fileIdToVersion)) {
        if (!validVersionIds.has(versionId)) {
          delete manifest.fileIdToVersion[fileId]
          prunedCount++
        }
      }
      if (prunedCount > 0 && options.debug) {
        logger.debug(`Pruned ${prunedCount} orphaned fileId entries from map`)
      }
    }

    // Save manifest if any changes were made
    if (removedVersions.length > 0 || (manifest.fileIdToVersion && Object.keys(manifest.fileIdToVersion).length > 0)) {
      await setVersionManifest(manifest, storage)
    }
  }

  async function storeAssetsInStorage(buildId: string, outputDir: string, assets: string[]) {
    const startTime = Date.now()
    logger.debug(`storeAssetsInStorage: starting for ${buildId} (${assets.length} assets)`)

    const publicDir = join(outputDir, 'public')

    const manifestStart = Date.now()
    const manifest = await getVersionManifest(storage)
    logger.debug(`storeAssetsInStorage: loaded manifest in ${formatDuration(Date.now() - manifestStart)}`)

    // Initialize fileIdToVersion map if it doesn't exist
    if (!manifest.fileIdToVersion) {
      manifest.fileIdToVersion = {}
    }

    const fileIdToVersion = manifest.fileIdToVersion
    const existingFileIds = Object.keys(fileIdToVersion).length
    logger.debug(`storeAssetsInStorage: fileIdToVersion has ${existingFileIds} entries`)

    // Calculate deletedChunks BEFORE deduplication, comparing current assets vs previous version's current state
    const currentVersion = manifest.versions[buildId]
    if (currentVersion) {
      const previousVersionId = getPreviousVersion(manifest, buildId)
      const previousAssets = previousVersionId ? manifest.versions[previousVersionId]?.assets || [] : []
      currentVersion.deletedChunks = calculateDeletedChunks(assets, previousAssets)
      logger.debug(`storeAssetsInStorage: calculated ${currentVersion.deletedChunks.length} deleted chunks vs ${previousVersionId || 'none'}`)
    }

    // Stats for logging
    let storedCount = 0
    let deduplicatedCount = 0
    let totalBytes = 0
    let skippedCount = 0

    const storeStart = Date.now()

    // Process assets in batches to limit memory usage
    // Use smaller batches for memory efficiency
    await processBatch(assets, 25, async (asset) => {
      const fileId = extractFileId(asset)

      // Check if already deduplicated BEFORE reading file (memory optimization)
      if (fileId && fileIdToVersion[fileId] === buildId) {
        skippedCount++
        return
      }

      // Store the file in current build's storage
      const assetPath = join(publicDir, asset)
      const assetData = await fs.readFile(assetPath).catch((error) => {
        logger.debug(`Failed to read ${assetPath}: ${error}`)
        return null
      })

      if (assetData) {
        totalBytes += assetData.byteLength
        const storageKey = `${buildId}/${asset}`
        await storage.setItemRaw(storageKey, assetData).catch((error) => {
          logger.error(`Failed to store ${storageKey}:`, error?.message || error)
        })
        storedCount++

        // Check if this file ID already exists in a previous version
        // If so, remove it from the old location since we now have it in the new location
        if (fileId && fileIdToVersion[fileId] && fileIdToVersion[fileId] !== buildId) {
          const previousVersionId = fileIdToVersion[fileId]

          // Remove the asset from the previous version's assets list
          if (manifest.versions[previousVersionId]) {
            const previousAssets = manifest.versions[previousVersionId].assets
            const assetIndex = previousAssets.findIndex(a => extractFileId(a) === fileId)
            if (assetIndex !== -1) {
              // Get the actual old asset path (may differ from current asset path)
              const oldAssetPath = previousAssets[assetIndex]
              previousAssets.splice(assetIndex, 1)

              // Remove from storage using the correct old path
              const oldStorageKey = `${previousVersionId}/${oldAssetPath}`
              await storage.removeItem(oldStorageKey).catch((error) => {
                logger.debug(`Failed to remove duplicate asset ${oldStorageKey}: ${error}`)
              })
              deduplicatedCount++
            }
          }
        }

        // Update the file ID mapping to point to the current version
        if (fileId) {
          fileIdToVersion[fileId] = buildId
        }
      }
    })

    logger.debug(`storeAssetsInStorage: stored ${storedCount} assets (${formatBytes(totalBytes)}) in ${formatDuration(Date.now() - storeStart)}`)
    logger.debug(`storeAssetsInStorage: deduplicated ${deduplicatedCount}, skipped ${skippedCount}`)

    // Save updated manifest with fileIdToVersion mapping
    const saveStart = Date.now()
    await setVersionManifest(manifest, storage)
    logger.debug(`storeAssetsInStorage: saved manifest in ${formatDuration(Date.now() - saveStart)}`)
    logger.debug(`storeAssetsInStorage: total ${formatDuration(Date.now() - startTime)}`)
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
    const startTime = Date.now()
    logger.debug(`restoreOldAssetsToPublic: starting for ${currentBuildId}`)

    const manifestStart = Date.now()
    const manifest = await getVersionManifest(storage)
    logger.debug(`restoreOldAssetsToPublic: loaded manifest in ${formatDuration(Date.now() - manifestStart)}`)

    if (!manifest || !manifest.versions) {
      logger.debug(`restoreOldAssetsToPublic: no manifest or versions, skipping`)
      return
    }

    // If this build ID already existed before this build, no need to restore
    // because the assets are already in place
    if (isExistingVersion) {
      logger.debug(`restoreOldAssetsToPublic: build ${currentBuildId} already exists, skipping restore`)
      return
    }

    const versionCount = Object.keys(manifest.versions).length - 1 // exclude current
    logger.debug(`restoreOldAssetsToPublic: checking ${versionCount} previous versions`)

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
    logger.debug(`restoreOldAssetsToPublic: current build has ${currentAssets.length} assets, ${currentFileIds.size} unique fileIds`)

    const now = Date.now()

    // Collect all asset restoration tasks across versions
    const assetTasks: Array<{ versionId: string, asset: string, versionData: any }> = []
    let skippedSamePath = 0
    let skippedSameFileId = 0

    for (const [versionId, versionData] of Object.entries(manifest.versions)) {
      if (versionId === currentBuildId) {
        continue
      }

      for (const asset of versionData.assets) {
        // Skip if this asset path is already in the current version
        if (currentAssetsSet.has(asset)) {
          skippedSamePath++
          continue
        }

        // Skip if a file with the same file ID exists in current version
        const fileId = extractFileId(asset)
        if (fileId && currentFileIds.has(fileId)) {
          skippedSameFileId++
          continue
        }

        assetTasks.push({ versionId, asset, versionData })
      }
    }

    logger.debug(`restoreOldAssetsToPublic: ${assetTasks.length} assets to restore (skipped: ${skippedSamePath} same path, ${skippedSameFileId} same fileId)`)

    if (assetTasks.length === 0) {
      logger.debug(`restoreOldAssetsToPublic: nothing to restore, total ${formatDuration(Date.now() - startTime)}`)
      return
    }

    const restoreStart = Date.now()
    let totalBytes = 0
    let failedCount = 0

    // Process restoration tasks in batches to limit memory
    // Use smaller batches for memory efficiency
    const batchResults = await processBatch(assetTasks, 25, async ({ versionId, asset, versionData }) => {
      const storageKey = `${versionId}/${asset}`
      return await storage.getItemRaw(storageKey)
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
            totalBytes += dataToWrite.byteLength

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

            return {
              asset,
              size: dataToWrite.byteLength,
              versionId,
              age: ageStr,
            }
          }
          return null
        })
        .catch((error) => {
          failedCount++
          logger.debug(`Failed to restore asset ${asset} from version ${versionId}: ${error}`)
          return null
        })
    })

    // Filter out null results and add to restoredAssets
    restoredAssets.push(...batchResults.filter((r): r is NonNullable<typeof r> => r !== null))

    logger.debug(`restoreOldAssetsToPublic: restored ${restoredAssets.length} assets (${formatBytes(totalBytes)}) in ${formatDuration(Date.now() - restoreStart)}${failedCount > 0 ? `, ${failedCount} failed` : ''}`)

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

    logger.debug(`restoreOldAssetsToPublic: total ${formatDuration(Date.now() - startTime)}`)
  }

  async function augmentBuildMetadata(buildId: string, outputDir: string) {
    const manifest = await getVersionManifest(storage)

    // Augment builds/latest.json
    const latestPath = join(outputDir, 'public', '_nuxt', 'builds', 'latest.json')
    try {
      const latestData = await fs.readFile(latestPath, 'utf-8')
      const latestJson = JSON.parse(latestData)

      // Clean up versions - only expose what client needs
      const clientVersions: Record<string, { timestamp: string, deletedChunks?: string[] }> = {}
      for (const [versionId, versionData] of Object.entries(manifest.versions)) {
        clientVersions[versionId] = {
          timestamp: versionData.timestamp,
          deletedChunks: versionData.deletedChunks,
        }
      }

      latestJson.skewProtection = {
        versions: clientVersions,
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
          deletedChunks: versionData.deletedChunks,
          timestamp: versionData.timestamp,
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
    augmentBuildMetadata,
    getManifest: () => getVersionManifest(storage),
  }
}
