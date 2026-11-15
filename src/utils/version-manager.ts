import type { Driver, Storage } from 'unstorage'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { colors } from 'consola/utils'
import { dirname, join } from 'pathe'
import { createStorage } from 'unstorage'
import { logger } from '../logger'

const RE_ENOTFOUND = /ENOTFOUND\s+(\S+)/
const RE_GETADDRINFO = /getaddrinfo\s+\S+\s+(\S+)/
const PENDING_UPLOADS_KEY = 'pending-uploads.json'
const RE_BLOB_KEY = /^blobs\/[a-f0-9]{64}(?:[-/][a-f0-9-]{36})?$/

interface PendingUploads {
  _tag: 'PendingUploads'
  keys: string[]
  uncertainKeys: string[]
}

function formatStorageError(error: unknown, operation: string): Error {
  const cause = error instanceof Error
    ? (error.cause as Error | undefined)
    : undefined
  const message = error instanceof Error
    ? error.message
    : String(error)
  const causeMessage = cause?.message || ''

  // DNS resolution failure
  if (causeMessage.includes('ENOTFOUND') || causeMessage.includes('getaddrinfo')) {
    const hostMatch = causeMessage.match(RE_ENOTFOUND) || causeMessage.match(RE_GETADDRINFO)
    const host = hostMatch?.[1] || 'unknown host'
    return new Error(`Storage ${operation} failed: Could not resolve host '${host}'. Check your storage URL/credentials are correct.`)
  }

  // Connection refused
  if (causeMessage.includes('ECONNREFUSED') || message.includes('ECONNREFUSED')) {
    return new Error(`Storage ${operation} failed: Connection refused. Is the storage server running and accessible?`)
  }

  // Auth/permission errors
  if (message.includes('401') || message.includes('Unauthorized') || message.includes('WRONGPASS')) {
    return new Error(`Storage ${operation} failed: Authentication failed. Check your storage credentials.`)
  }

  // Timeout
  if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return new Error(`Storage ${operation} failed: Connection timed out. Check network connectivity to storage.`)
  }

  // Generic fetch failure
  if (message === 'fetch failed') {
    return new Error(`Storage ${operation} failed: Network error. ${causeMessage || 'Check your storage configuration.'}`)
  }

  return new Error(`Storage ${operation} failed: ${message}`)
}

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
    // Finish in-flight requests before a failed build disposes its storage driver.
    const batchResults = await Promise.allSettled(batch.map(processor))
    for (const result of batchResults) {
      if (result.status === 'rejected')
        throw result.reason
      results.push(result.value)
    }
  }
  return results
}

// Unified manifest format used by all platforms
export interface VersionManifest {
  current: string
  versions: Record<string, {
    timestamp: string
    expires: string
    // Assets currently stored for this version (shrinks as newer versions deduplicate)
    assets: string[]
    // Content-addressed objects. Older manifests use version-prefixed keys.
    storageKeys?: Record<string, string>
    // Original assets at build time (never changes, used for deletedChunks calculation)
    originalAssets?: string[]
    // Chunks deleted in this version compared to previous version
    deletedChunks?: string[]
  }>
  // Maps file IDs (hashes from filename) to the latest version that contains them
  fileIdToVersion?: Record<string, string>
}

function assetOutputPath(publicDir: string, asset: string): string {
  const root = resolve(publicDir)
  const target = resolve(root, asset)
  const path = relative(root, target)
  if (!path || isAbsolute(asset) || asset.includes('\\') || path === '..' || path.startsWith(`..${sep}`))
    throw new Error(`Invalid asset path: ${asset}`)
  return target
}

function assetStorageKey(versionId: string, version: Pick<VersionManifest['versions'][string], 'storageKeys'>, asset: string): string {
  return version.storageKeys?.[asset] || `${versionId}/${asset}`
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
    .map(([id, data], index) => ({
      id,
      timestamp: new Date(data.timestamp).getTime(),
      index,
    }))
    .sort((a, b) => b.timestamp - a.timestamp || b.index - a.index)

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
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function getVersionManifest(storage: Storage): Promise<VersionManifest> {
  const emptyManifest: VersionManifest = { current: '', versions: {} }

  return storage.getItem('version-manifest.json')
    .then((manifest) => {
      if (manifest === null)
        return emptyManifest
      if (!isRecord(manifest) || typeof manifest.current !== 'string' || !isRecord(manifest.versions))
        throw new TypeError('Invalid version manifest. Expected version asset references.')
      for (const version of Object.values(manifest.versions)) {
        if (!isRecord(version) || !Array.isArray(version.assets)
          || !version.assets.every(asset => typeof asset === 'string' && asset.length > 0)
          || (version.storageKeys !== undefined && (!isRecord(version.storageKeys)
            || !Object.values(version.storageKeys).every(key => typeof key === 'string' && key.length > 0)))) {
          throw new TypeError('Invalid version manifest. Expected version asset references.')
        }
      }
      return manifest as unknown as VersionManifest
    })
    .catch((e: unknown) => { throw formatStorageError(e, 'read') })
}

// Update the manifest
async function setVersionManifest(manifest: VersionManifest, storage: Storage): Promise<void> {
  await storage.setItem('version-manifest.json', manifest)
    .catch((e) => { throw formatStorageError(e, 'write') })
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

function formatAge(timestamp: number, now: number): string {
  const ageMinutes = Math.floor((now - timestamp) / 60000)
  const ageHours = Math.floor(ageMinutes / 60)
  const ageDays = Math.floor(ageHours / 24)
  if (ageDays > 0)
    return `${ageDays}d ago`
  if (ageHours > 0)
    return `${ageHours}h ago`
  if (ageMinutes > 0)
    return `${ageMinutes}m ago`
  return 'just now'
}

export function createAssetManager(options: {
  driver?: Driver
  retentionDays?: number
  maxNumberOfVersions?: number
  buildAssetsDir?: string
  persistAssets?: boolean
  readConsistency?: 'strong' | 'eventual'
  debug?: boolean
}) {
  // Create storage with proper driver
  const storage: Storage = createStorage({
    driver: options.driver,
  })
  const retentionDays = options.retentionDays || 7
  const maxNumberOfVersions = options.maxNumberOfVersions || 20
  const buildAssetsDir = (options.buildAssetsDir || '/_nuxt/').replace(/^\/+|\/+$/g, '')
  const persistAssets = options.persistAssets !== false
  const readConsistency = options.readConsistency
    ?? (['memory', 'fs', 'fs-lite'].includes(options.driver?.name || '')
      ? 'strong'
      : 'eventual')

  function safetyKey(key: string) {
    return `asset-operations/${createHash('sha256').update(key).digest('hex')}`
  }

  async function hasUncertainOperation(key: string): Promise<boolean> {
    const operation = await storage.getItem(safetyKey(key))
    if (operation === null)
      return false
    if (typeof operation !== 'string')
      throw new TypeError('Invalid pending asset uploads. Expected content-addressed object keys.')
    return await storage.getItem(`asset-operation-completions/${operation}`) !== true
  }

  async function protectAssetOperation(keys: Iterable<string>) {
    const operation = randomUUID()
    const uniqueKeys = [
      ...new Set(keys),
    ]
    await processBatch(uniqueKeys, 50, async (key) => {
      // Never replace an unresolved operation, including one hidden by a stale journal PUT.
      if (!await hasUncertainOperation(key))
        await storage.setItem(safetyKey(key), operation)
    })
    // A completion belongs only to this operation. A delayed completion cannot
    // clear a newer guard. A failed guard PUT never receives a completion.
    return () => storage.setItem(`asset-operation-completions/${operation}`, true)
  }

  function limitVersionCount(manifest: VersionManifest, buildId: string): string[] {
    const removedKeys: string[] = []
    const previousVersions = Object.entries(manifest.versions)
      .filter(([id]) => id !== buildId)
      .sort(([, a], [, b]) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    for (const [id, data] of previousVersions.slice(Math.max(0, maxNumberOfVersions - 1))) {
      removedKeys.push(...data.assets.map(asset => assetStorageKey(id, data, asset)))
      delete manifest.versions[id]
      for (const [fileId, versionId] of Object.entries(manifest.fileIdToVersion || {})) {
        if (versionId === id)
          delete manifest.fileIdToVersion![fileId]
      }
    }
    return removedKeys
  }

  async function removeUnreferencedAssets(manifest: VersionManifest, keys: Iterable<string>) {
    const pending = await getPendingUploads()
    const { uncertainKeys } = pending
    const uncertain = new Set(uncertainKeys)
    const retainedKeys = new Set(Object.entries(manifest.versions).flatMap(([id, version]) =>
      version.assets.map(asset => assetStorageKey(id, version, asset))))
    const candidates = [
      ...new Set(keys),
    ].filter(key => !retainedKeys.has(key))
    await processBatch(candidates, 50, async (key) => {
      if (await hasUncertainOperation(key))
        uncertain.add(key)
    })
    const deletable = new Set(candidates.filter(key => RE_BLOB_KEY.test(key) && readConsistency === 'strong' && !uncertain.has(key)))
    if (deletable.size > 0) {
      // A failed DELETE can still finish later. Persist its keys before sending the request.
      await storage.setItem(PENDING_UPLOADS_KEY, {
        ...pending,
        keys: [
          ...new Set([
            ...pending.keys,
            ...deletable,
          ]),
        ],
        uncertainKeys: [
          ...new Set([
            ...pending.uncertainKeys,
            ...deletable,
          ]),
        ],
      })
    }
    const results = await processBatch(candidates, 50, async (key) => {
      if (uncertain.has(key) || (RE_BLOB_KEY.test(key) && !deletable.has(key)))
        return key
      const complete = await protectAssetOperation([key])
      return storage.removeItem(key).then(async () => {
        await complete()
        return undefined
      }).catch((error) => {
        logger.warn(`Failed to remove asset ${key}:`, error)
        return key
      })
    })
    const remaining = results.filter((key): key is string => key !== undefined)
    const remainingKeys = new Set(remaining)
    const completed = new Set([...deletable].filter(key => !remainingKeys.has(key)))
    if (completed.size > 0) {
      const current = await getPendingUploads()
      await storage.setItem(PENDING_UPLOADS_KEY, {
        ...current,
        keys: current.keys.filter(key => !completed.has(key)),
        uncertainKeys: current.uncertainKeys.filter(key => !completed.has(key)),
      }).catch(error => logger.warn('Failed to record confirmed asset deletion:', error))
    }
    return remaining
  }

  async function getPendingUploads(): Promise<PendingUploads> {
    const value: unknown = await storage.getItem(PENDING_UPLOADS_KEY)
    if (value === null)
      return { _tag: 'PendingUploads', keys: [], uncertainKeys: [] }
    if (
      typeof value !== 'object' || value === null
      || !('_tag' in value) || value._tag !== 'PendingUploads'
      || !('keys' in value) || !Array.isArray(value.keys)
      || !value.keys.every(key => typeof key === 'string' && RE_BLOB_KEY.test(key))
    ) {
      throw new TypeError('Invalid pending asset uploads. Expected content-addressed object keys.')
    }
    const keys: string[] = value.keys
    // Records without a commit outcome cannot authorize deletion.
    const uncertainKeys: unknown = 'uncertainKeys' in value
      ? value.uncertainKeys
      : keys
    if (!Array.isArray(uncertainKeys)
      || !uncertainKeys.every(key => typeof key === 'string' && key.length > 0)) {
      throw new TypeError('Invalid pending asset uploads. Expected content-addressed object keys.')
    }
    return {
      _tag: 'PendingUploads',
      keys,
      uncertainKeys,
    }
  }

  async function recordPendingUploads(keys: Iterable<string>) {
    const additions = [...keys].filter(key => RE_BLOB_KEY.test(key))
    if (additions.length === 0)
      return
    const previous = await getPendingUploads()
    const pending = new Set([
      ...previous.keys,
      ...additions,
    ])
    await storage.setItem(PENDING_UPLOADS_KEY, {
      _tag: 'PendingUploads',
      keys: [...pending],
      uncertainKeys: previous.uncertainKeys,
    })
  }

  async function commitVersionManifest(manifest: VersionManifest) {
    const previous = await getPendingUploads()
    const references = Object.entries(manifest.versions).flatMap(([id, version]) =>
      version.assets.map(asset => assetStorageKey(id, version, asset)))
    const keys = [
      ...new Set([
        ...previous.keys,
        ...references.filter(key => RE_BLOB_KEY.test(key)),
      ]),
    ]
    if (references.length > 0) {
      // Persist uncertainty before the write. A rejected request may still commit later.
      await storage.setItem(PENDING_UPLOADS_KEY, {
        _tag: 'PendingUploads',
        keys,
        uncertainKeys: [
          ...new Set([
            ...previous.uncertainKeys,
            ...references,
          ]),
        ],
      })
    }
    const complete = await protectAssetOperation(references)
    await setVersionManifest(manifest, storage)
    await complete().catch(error => logger.warn('Failed to record the confirmed asset publication:', error))
    if (references.length > 0) {
      await storage.setItem(PENDING_UPLOADS_KEY, {
        _tag: 'PendingUploads',
        keys,
        uncertainKeys: previous.uncertainKeys,
      }).catch(error => logger.warn('Failed to record the confirmed asset publication:', error))
    }
  }

  async function recoverPendingUploads(manifest: VersionManifest) {
    if (readConsistency !== 'strong')
      return
    const pending = await getPendingUploads()
    const uncertain = new Set(pending.uncertainKeys)
    const candidates = pending.keys.filter(key => !uncertain.has(key))
    if (candidates.length === 0)
      return
    const remaining = await removeUnreferencedAssets(manifest, candidates)
    const current = await getPendingUploads()
    await storage.setItem(PENDING_UPLOADS_KEY, {
      ...current,
      keys: [
        ...new Set([
          ...remaining,
          ...current.uncertainKeys.filter(key => RE_BLOB_KEY.test(key)),
        ]),
      ],
    })
  }

  async function finishAssetCleanup(manifest: VersionManifest, keys: Iterable<string>) {
    // Only this successful commit authorizes removals. Storage reads can be stale,
    // including reads that report an absent manifest after a lost write response.
    const candidates = new Set(keys)
    const failed = new Set(await removeUnreferencedAssets(manifest, candidates))
    const retained = new Set(Object.entries(manifest.versions).flatMap(([id, version]) =>
      version.assets.map(asset => assetStorageKey(id, version, asset))))
    await getPendingUploads().then((pending) => {
      const uncertain = new Set(pending.uncertainKeys)
      return storage.setItem(PENDING_UPLOADS_KEY, {
        ...pending,
        // An uncertain request can still commit later, even after an authoritative negative read.
        keys: pending.keys.filter(key => uncertain.has(key) || failed.has(key) || (!candidates.has(key) && !retained.has(key))),
      })
    }).catch(error => logger.warn('Failed to clean pending asset uploads:', error))
  }

  async function getAssetsFromBuild(publicDir: string) {
    const startTime = Date.now()
    const nuxtDir = join(publicDir, buildAssetsDir)

    logger.debug(`Scanning build assets from ${nuxtDir}`)

    const assets: string[] = []
    const nuxtFiles = await getFilesRecursively(nuxtDir)

    for (const file of nuxtFiles) {
      const relativePath = file.replace(nuxtDir, '')
      assets.push(`${buildAssetsDir}${relativePath}`)
    }

    if (assets.length === 0) {
      throw new Error(`No build assets found in ${nuxtDir}. Check that app.buildAssetsDir matches the generated output.`)
    }

    logger.debug(`Found ${assets.length} assets in ${formatDuration(Date.now() - startTime)}`)
    return assets
  }

  async function updateVersionsManifest(buildId: string, assets: string[], save = true) {
    const startTime = Date.now()
    logger.debug(`updateVersionsManifest: starting for ${buildId}`)

    const now = new Date()
    const expires = new Date(now.getTime() + (retentionDays * 24 * 60 * 60 * 1000))

    const manifestStart = Date.now()
    const manifest = await getVersionManifest(storage)
    logger.debug(`updateVersionsManifest: loaded manifest in ${formatDuration(Date.now() - manifestStart)} (${Object.keys(manifest.versions).length} versions)`)

    // Check if this version already exists.
    const isExistingVersion = !!manifest.versions[buildId]
    const previousVersionId = manifest.current && manifest.current !== buildId
      ? manifest.current
      : getPreviousVersion(manifest, buildId)
    const previousVersion = previousVersionId ? manifest.versions[previousVersionId] : undefined
    const previousAssets = previousVersion?.originalAssets || previousVersion?.assets || []

    manifest.current = buildId
    manifest.versions[buildId] = {
      timestamp: now.toISOString(),
      expires: expires.toISOString(),
      assets: persistAssets
        ? [...assets]
        : [],
      // Store original assets for deletedChunks calculation (assets array gets modified by deduplication)
      originalAssets: [...assets],
      deletedChunks: calculateDeletedChunks(assets, previousAssets),
    }

    const saveStart = Date.now()
    if (save)
      await commitVersionManifest(manifest)
    logger.debug(`updateVersionsManifest: saved manifest in ${formatDuration(Date.now() - saveStart)}`)
    logger.debug(`updateVersionsManifest: total ${formatDuration(Date.now() - startTime)}`)

    return { manifest, isExistingVersion }
  }

  async function cleanupExpiredVersions() {
    // Validate the journal, but do not infer abandoned objects from a storage read.
    await getPendingUploads()
    const manifest = await getVersionManifest(storage)
    await recoverPendingUploads(manifest)
    if (!manifest || !manifest.versions) {
      return
    }

    const now = new Date()
    const removedVersions: Array<{ id: string, reason: string, assetCount: number }> = []
    const removedKeys = new Set<string>()
    let prunedCount = 0

    const sortedVersions = Object.entries(manifest.versions)
      .map(([id, data]) => ({
        id,
        ...data,
        timestamp: new Date(data.timestamp).getTime(),
      }))
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
        for (const asset of version.assets)
          removedKeys.add(assetStorageKey(version.id, version, asset))

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
        const assetInfo = `(${item.assetCount} asset${item.assetCount > 1
          ? 's'
          : ''})`
        const reasonInfo = `[${item.reason}]`

        logger.log(colors.gray(`${prefix} ${versionInfo} ${assetInfo} ${reasonInfo}`))
      })
    }

    // Final pruning: remove any orphaned fileId entries referencing non-existent versions
    if (manifest.fileIdToVersion) {
      const validVersionIds = new Set(Object.keys(manifest.versions))
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
    if (removedVersions.length > 0 || prunedCount > 0) {
      await recordPendingUploads(removedKeys)
      await commitVersionManifest(manifest)
      // Publish removals before deleting bytes. A failed write keeps history restorable.
      await finishAssetCleanup(manifest, removedKeys)
    }
  }

  async function storeAssetsInStorage(buildId: string, publicDir: string, assets: string[], preparedManifest?: VersionManifest) {
    const startTime = Date.now()
    logger.debug(`storeAssetsInStorage: starting for ${buildId} (${assets.length} assets)`)

    const manifestStart = Date.now()
    const manifest = preparedManifest || await getVersionManifest(storage)
    logger.debug(`storeAssetsInStorage: loaded manifest in ${formatDuration(Date.now() - manifestStart)}`)

    // Initialize fileIdToVersion map if it doesn't exist
    if (!manifest.fileIdToVersion) {
      manifest.fileIdToVersion = {}
    }

    const fileIdToVersion = manifest.fileIdToVersion
    const existingFileIds = Object.keys(fileIdToVersion).length
    logger.debug(`storeAssetsInStorage: fileIdToVersion has ${existingFileIds} entries`)

    // Stats for logging
    let storedCount = 0
    let deduplicatedCount = 0
    let totalBytes = 0
    let skippedCount = 0
    const supersededKeys: string[] = []
    const version = manifest.versions[buildId]!
    version.storageKeys = {}
    const uploads = new Map<string, Promise<void>>()
    const uncertainObjectKeys = new Set((await getPendingUploads()).uncertainKeys)
    const reusableKeys = new Map<string, string>()
    for (const data of Object.values(manifest.versions)) {
      for (const key of Object.values(data.storageKeys || {})) {
        if (RE_BLOB_KEY.test(key) && !uncertainObjectKeys.has(key) && !await hasUncertainOperation(key))
          reusableKeys.set(key.slice('blobs/'.length, 'blobs/'.length + 64), key)
      }
    }

    const storeStart = Date.now()

    for (let index = 0; index < assets.length; index += 25) {
      const batch = await processBatch(assets.slice(index, index + 25), 25, async (asset) => {
        const assetData = await fs.readFile(assetOutputPath(publicDir, asset))
        const hash = createHash('sha256').update(assetData).digest('hex')
        const canonicalKey = `blobs/${hash}`
        const storageKey = reusableKeys.get(hash) || (uncertainObjectKeys.has(canonicalKey) || await hasUncertainOperation(canonicalKey)
          // Keep replacements beside canonical files for filesystem drivers.
          ? `${canonicalKey}-${randomUUID()}`
          : canonicalKey)
        reusableKeys.set(hash, storageKey)
        return { asset, assetData, storageKey }
      })
      // Persist candidates before uploading this batch, so a stopped process can recover later.
      await recordPendingUploads(batch.map(item => item.storageKey))
      await processBatch(batch, 25, async ({ asset, assetData, storageKey }) => {
        const fileId = extractFileId(asset)

        if (assetData) {
          totalBytes += assetData.byteLength
          let upload = uploads.get(storageKey)
          if (!upload) {
            upload = (async () => {
              if (await storage.hasItem(storageKey)) {
                skippedCount++
                return
              }
              await storage.setItemRaw(storageKey, assetData)
              storedCount++
            })()
            uploads.set(storageKey, upload)
          }
          await upload
          version.storageKeys![asset] = storageKey

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
                const oldStorageKey = assetStorageKey(previousVersionId, manifest.versions[previousVersionId], oldAssetPath!)
                supersededKeys.push(oldStorageKey)
                delete manifest.versions[previousVersionId].storageKeys?.[oldAssetPath!]
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
    }

    logger.debug(`storeAssetsInStorage: stored ${storedCount} assets (${formatBytes(totalBytes)}) in ${formatDuration(Date.now() - storeStart)}`)
    logger.debug(`storeAssetsInStorage: deduplicated ${deduplicatedCount}, skipped ${skippedCount}`)

    // Reserve the new release's slot only after the old current release was restored.
    supersededKeys.push(...limitVersionCount(manifest, buildId))

    // Save updated manifest with fileIdToVersion mapping
    const saveStart = Date.now()
    await recordPendingUploads(supersededKeys)
    await commitVersionManifest(manifest)
    await finishAssetCleanup(manifest, supersededKeys)
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

  async function restoreOldAssetsToPublic(currentBuildId: string, publicDir: string, currentAssets: string[] = []) {
    const startTime = Date.now()
    logger.debug(`restoreOldAssetsToPublic: starting for ${currentBuildId}`)

    const manifestStart = Date.now()
    const manifest = await getVersionManifest(storage)
    logger.debug(`restoreOldAssetsToPublic: loaded manifest in ${formatDuration(Date.now() - manifestStart)}`)

    if (!manifest || !manifest.versions) {
      logger.debug(`restoreOldAssetsToPublic: no manifest or versions, skipping`)
      return
    }

    const versionCount = Object.keys(manifest.versions).length - 1 // exclude current
    logger.debug(`restoreOldAssetsToPublic: checking ${versionCount} previous versions`)
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
    const collectedPaths = new Set<string>()

    for (const [versionId, versionData] of Object.entries(manifest.versions)) {
      if (versionId === currentBuildId) {
        continue
      }

      for (const asset of versionData.assets) {
        assetOutputPath(publicDir, asset)
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

        // Skip if already collected from another old version
        if (collectedPaths.has(asset)) {
          continue
        }
        collectedPaths.add(asset)

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
    const createdDirs = new Set<string>()

    // Process restoration tasks in batches to limit memory
    // Use smaller batches for memory efficiency
    const batchResults = await processBatch(assetTasks, 25, async ({ versionId, asset, versionData }) => {
      const storageKey = assetStorageKey(versionId, versionData, asset)
      return await storage.getItemRaw(storageKey)
        .then(async (assetData) => {
          if (assetData) {
            const targetPath = assetOutputPath(publicDir, asset)
            const dir = dirname(targetPath)

            if (!createdDirs.has(dir)) {
              await fs.mkdir(dir, { recursive: true })
              createdDirs.add(dir)
            }

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
            // wx flag = exclusive write, fails if file exists (atomic check+write)
            await fs.writeFile(targetPath, dataToWrite, { flag: 'wx' })
            totalBytes += dataToWrite.byteLength

            // Calculate time ago
            const versionTimestamp = new Date(versionData.timestamp).getTime()

            return {
              asset,
              size: dataToWrite.byteLength,
              versionId,
              age: formatAge(versionTimestamp, now),
            }
          }
          throw new Error(`Stored asset ${storageKey} is missing.`)
        })
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'EEXIST') {
            return null
          }
          throw error
        })
    })

    // Filter out null results and add to restoredAssets
    restoredAssets.push(...batchResults.filter((r): r is NonNullable<typeof r> => r !== null))

    logger.debug(`restoreOldAssetsToPublic: restored ${restoredAssets.length} assets (${formatBytes(totalBytes)}) in ${formatDuration(Date.now() - restoreStart)}`)

    // Count restored assets per version
    const restoredByVersion = new Map<string, number>()
    for (const item of restoredAssets) {
      restoredByVersion.set(item.versionId, (restoredByVersion.get(item.versionId) || 0) + 1)
    }

    // Log summary per version showing restored/total
    const otherVersions = Object.entries(manifest.versions).filter(([id]) => id !== currentBuildId)
    if (otherVersions.length > 0) {
      otherVersions.forEach(([versionId, versionData], index) => {
        const isLast = index === otherVersions.length - 1
        const prefix = isLast ? '  └─' : '  ├─'
        const versionTimestamp = new Date(versionData.timestamp).getTime()
        const ageStr = formatAge(versionTimestamp, now)
        const restored = restoredByVersion.get(versionId) || 0
        const total = versionData.originalAssets?.length || versionData.assets.length
        logger.log(colors.gray(`${prefix} ${versionId.slice(0, 8)} (${restored}/${total} files restored, ${ageStr})`))
      })
    }

    logger.debug(`restoreOldAssetsToPublic: total ${formatDuration(Date.now() - startTime)}`)
  }

  /**
   * Nuxt clients poll builds/latest.json, so it carries only version timestamps.
   * The deleted chunk lists go to builds/skew/{buildId}.json, which a client
   * fetches only after it detects a new build.
   */
  async function augmentBuildMetadata(buildId: string, publicDir: string, preparedManifest?: VersionManifest) {
    const manifest = preparedManifest || await getVersionManifest(storage)
    const buildsDir = join(publicDir, buildAssetsDir, 'builds')

    const versions: Record<string, { timestamp: string }> = {}
    const deletedChunks: Record<string, string[]> = {}
    for (const [versionId, versionData] of Object.entries(manifest.versions)) {
      versions[versionId] = { timestamp: versionData.timestamp }
      if (versionData.deletedChunks?.length)
        deletedChunks[versionId] = versionData.deletedChunks
    }

    const latestPath = join(buildsDir, 'latest.json')
    await fs.readFile(latestPath, 'utf-8')
      .then(async (latestData) => {
        const latestJson = JSON.parse(latestData)
        latestJson.skewProtection = { versions }
        await fs.writeFile(latestPath, JSON.stringify(latestJson), 'utf-8')
      })
      .catch((error: unknown) => {
        const message = error instanceof Error
          ? error.message
          : String(error)
        throw new Error(`Failed to augment builds/latest.json: ${message}`)
      })

    const metaPath = join(buildsDir, 'meta', `${buildId}.json`)
    await fs.readFile(metaPath, 'utf-8')
      .then(async (metaData) => {
        const metaJson = JSON.parse(metaData)
        const timestamp = versions[buildId]?.timestamp
        if (timestamp)
          metaJson.skewProtection = { timestamp }
        await fs.writeFile(metaPath, JSON.stringify(metaJson), 'utf-8')
      })
      .catch((error: unknown) => {
        const message = error instanceof Error
          ? error.message
          : String(error)
        throw new Error(`Failed to augment builds/meta/${buildId}.json: ${message}`)
      })

    const skewPath = join(buildsDir, 'skew', `${buildId}.json`)
    await fs.mkdir(dirname(skewPath), { recursive: true })
    await fs.writeFile(skewPath, JSON.stringify({ deletedChunks }), 'utf-8')
  }

  async function publishBuild(buildId: string, publicDir: string, assets: string[]) {
    // Keep current pointing at the live release while pruning and restoring history.
    await cleanupExpiredVersions()
    const { manifest } = await updateVersionsManifest(buildId, assets, false)
    await augmentBuildMetadata(buildId, publicDir, manifest)
    if (persistAssets) {
      const skewAsset = `${buildAssetsDir}/builds/skew/${buildId}.json`
      const storedAssets = [
        ...new Set([...assets, skewAsset]),
      ]
      manifest.versions[buildId]!.assets = storedAssets
      await restoreOldAssetsToPublic(buildId, publicDir, storedAssets)
      await storeAssetsInStorage(buildId, publicDir, storedAssets, manifest)
    }
    else {
      const removedKeys = limitVersionCount(manifest, buildId)
      await recordPendingUploads(removedKeys)
      await commitVersionManifest(manifest)
      await finishAssetCleanup(manifest, removedKeys)
    }
  }

  return {
    publishBuild,
    getAssetsFromBuild,
    updateVersionsManifest,
    cleanupExpiredVersions,
    storeAssetsInStorage,
    listExistingVersions,
    restoreOldAssetsToPublic,
    augmentBuildMetadata,
    getManifest: () => getVersionManifest(storage),
    dispose: () => storage.dispose(),
  }
}
