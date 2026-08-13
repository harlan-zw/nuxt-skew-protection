import type { Driver, Storage } from 'unstorage'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { colors } from 'consola/utils'
import { dirname, join } from 'pathe'
import { createStorage } from 'unstorage'
import { z } from 'zod'
import { logger } from '../logger'

const RE_ENOTFOUND = /ENOTFOUND\s+(\S+)/
const RE_GETADDRINFO = /getaddrinfo\s+\S+\s+(\S+)/
const RE_SIZE_PROP = /(['"]?)size\1\s*:\s*\d+/
const RE_SIZE_PREFIX = /^(['"]?)size\1\s*:\s*/
const RE_ETAG_PROP = /(['"]?)etag\1\s*:\s*(['"])(?:[^\\]|\\.)*?\2/
const RE_ETAG_KEY_PREFIX = /^(['"]?)etag\1\s*:\s*/
const RE_ETAG_QUOTE = /:\s*(['"])/
const RE_ESCAPE_DOUBLE_QUOTE = /"/g
const RE_SAFE_BUILD_ID = /^[\w.-]+$/
const VERSION_RECORD_PREFIX = 'version-records'
const VERSION_ASSET_PREFIX = 'version-assets'
const VERSION_RECORD_SCHEMA = 2 as const

const versionRecordSchema = z.object({
  schemaVersion: z.literal(VERSION_RECORD_SCHEMA),
  id: z.string().min(1),
  timestamp: z.iso.datetime(),
  expires: z.iso.datetime(),
  bundled: z.boolean(),
  assets: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
})

type VersionRecord = z.infer<typeof versionRecordSchema>

export interface VersionManifest {
  current: string
  versions: Record<string, {
    timestamp: string
    expires: string
    assets: string[]
  }>
}

function assertSafeBuildId(buildId: string): void {
  if (!RE_SAFE_BUILD_ID.test(buildId) || buildId === '.' || buildId === '..')
    throw new Error(`Invalid build ID ${JSON.stringify(buildId)}. Use letters, numbers, dots, underscores, or hyphens.`)
}

function assertSafeAssetPath(asset: string): void {
  const segments = asset.split('/')
  if (!asset || asset.startsWith('/') || segments.some(segment => !segment || segment === '.' || segment === '..'))
    throw new Error(`Invalid build asset path ${JSON.stringify(asset)}.`)
}

function recordKey(buildId: string): string {
  assertSafeBuildId(buildId)
  return `${VERSION_RECORD_PREFIX}/${buildId}.json`
}

function assetKey(buildId: string, asset: string): string {
  assertSafeBuildId(buildId)
  assertSafeAssetPath(asset)
  return `${VERSION_ASSET_PREFIX}/${buildId}/${asset}`
}

function formatStorageError(error: unknown, operation: string): Error {
  const cause = error instanceof Error ? (error.cause as Error | undefined) : undefined
  const message = error instanceof Error ? error.message : String(error)
  const causeMessage = cause?.message || ''

  if (causeMessage.includes('ENOTFOUND') || causeMessage.includes('getaddrinfo')) {
    const hostMatch = causeMessage.match(RE_ENOTFOUND) || causeMessage.match(RE_GETADDRINFO)
    const host = hostMatch?.[1] || 'unknown host'
    return new Error(`Storage ${operation} failed: Could not resolve host '${host}'. Check your storage URL and credentials.`, { cause: error })
  }
  if (causeMessage.includes('ECONNREFUSED') || message.includes('ECONNREFUSED'))
    return new Error(`Storage ${operation} failed: Connection refused. Is the storage server reachable?`, { cause: error })
  if (message.includes('401') || message.includes('Unauthorized') || message.includes('WRONGPASS'))
    return new Error(`Storage ${operation} failed: Authentication failed. Check your storage credentials.`, { cause: error })
  if (message.includes('timeout') || message.includes('ETIMEDOUT'))
    return new Error(`Storage ${operation} failed: Connection timed out.`, { cause: error })
  if (message === 'fetch failed')
    return new Error(`Storage ${operation} failed: Network error. ${causeMessage || 'Check your storage configuration.'}`, { cause: error })
  return new Error(`Storage ${operation} failed: ${message}`, { cause: error })
}

async function fromStorage<T>(operation: string, read: () => Promise<T>): Promise<T> {
  return read().catch((error: unknown) => {
    throw formatStorageError(error, operation)
  })
}

async function processBatch<T, R>(items: T[], batchSize: number, processor: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let index = 0; index < items.length; index += batchSize)
    results.push(...await Promise.all(items.slice(index, index + batchSize).map(processor)))
  return results
}

async function getFilesRecursively(dir: string): Promise<string[]> {
  const items = await fs.readdir(dir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT')
      return []
    throw error
  })
  const files: string[] = []
  for (const item of items) {
    const fullPath = join(dir, item.name)
    if (item.isDirectory())
      files.push(...await getFilesRecursively(fullPath))
    else
      files.push(fullPath)
  }
  return files
}

function parseVersionRecord(value: unknown, key: string): VersionRecord {
  const parsed = versionRecordSchema.safeParse(value)
  if (!parsed.success)
    throw new Error(`Stored skew protection record ${key} is invalid: ${z.prettifyError(parsed.error)}`)
  assertSafeBuildId(parsed.data.id)
  Object.keys(parsed.data.assets).forEach(assertSafeAssetPath)
  return parsed.data
}

function toBuffer(value: unknown, description: string): Buffer {
  if (Buffer.isBuffer(value))
    return value
  if (typeof value === 'string' || value instanceof Uint8Array)
    return Buffer.from(value)
  if (value instanceof ArrayBuffer)
    return Buffer.from(value)
  if (value && typeof value === 'object' && 'type' in value && value.type === 'Buffer' && 'data' in value && Array.isArray(value.data))
    return Buffer.from(value.data)
  throw new Error(`${description} has an unsupported storage representation.`)
}

async function getVersionRecords(storage: Storage): Promise<VersionRecord[]> {
  const keys = await fromStorage('list version records', () => storage.getKeys(VERSION_RECORD_PREFIX))
  const records = await processBatch(keys, 25, async (key) => {
    const value = await fromStorage(`read ${key}`, () => storage.getItem(key))
    if (value === null)
      return null
    return parseVersionRecord(value, key)
  })
  return records.filter((record): record is VersionRecord => record !== null)
}

function toManifest(records: VersionRecord[], current: string): VersionManifest {
  return {
    current,
    versions: Object.fromEntries(records.map(record => [record.id, {
      timestamp: record.timestamp,
      expires: record.expires,
      assets: Object.keys(record.assets),
    }])),
  }
}
function formatBytes(bytes: number): string {
  if (bytes < 1024)
    return `${bytes}B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`
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
  storage?: Storage
  retentionDays?: number
  maxNumberOfVersions?: number
  buildAssetsDir?: string
  debug?: boolean
}) {
  const storage = options.storage || createStorage({ driver: options.driver })
  const retentionDays = options.retentionDays ?? 30
  const maxNumberOfVersions = options.maxNumberOfVersions ?? 10
  const buildAssetsDir = (options.buildAssetsDir || '/_nuxt/').replace(/^\/+|\/+$/g, '')
  const buildAssetsPath = `/${buildAssetsDir}`
  const mutableAssets = new Set([`${buildAssetsDir}/builds/latest.json`])
  let currentBuildId = ''

  async function getAssetsFromBuild(publicDir: string): Promise<string[]> {
    const startedAt = Date.now()
    const nuxtDir = join(publicDir, buildAssetsDir)
    const files = await getFilesRecursively(nuxtDir)
    const assets = files
      .map(file => `${buildAssetsDir}${file.slice(nuxtDir.length)}`)
      .sort()
    if (assets.length === 0)
      throw new Error(`No build assets found in ${nuxtDir}. Check that app.buildAssetsDir matches the generated output.`)
    logger.debug(`Found ${assets.length} assets in ${formatDuration(Date.now() - startedAt)}`)
    return assets
  }

  async function storeVersion(
    buildId: string,
    publicDir: string,
    assets: string[],
    options: { bundleAssets?: boolean } = {},
  ): Promise<VersionRecord> {
    assertSafeBuildId(buildId)
    const protectedAssets = [...new Set(assets.filter(asset => !mutableAssets.has(asset)))]
    protectedAssets.forEach(assertSafeAssetPath)
    if (protectedAssets.length === 0)
      throw new Error(`Build ${buildId} contains no immutable assets to protect.`)

    const existingRecords = await getVersionRecords(storage)
    const previousHashes = new Map<string, string>()
    for (const record of existingRecords) {
      for (const [asset, hash] of Object.entries(record.assets)) {
        const existingHash = previousHashes.get(asset)
        if (existingHash && existingHash !== hash)
          throw new Error(`Stored versions disagree about immutable asset ${asset}. Clear the skew protection storage before deploying.`)
        previousHashes.set(asset, hash)
      }
    }

    let totalBytes = 0
    const storedAssets = await processBatch(protectedAssets, 25, async (asset) => {
      const sourcePath = join(publicDir, asset)
      const data = await fs.readFile(sourcePath).catch((error: unknown) => {
        throw new Error(`Failed to read build asset ${sourcePath}.`, { cause: error })
      })
      const hash = createHash('sha256').update(data).digest('hex')
      const previousHash = previousHashes.get(asset)
      if (previousHash && previousHash !== hash)
        throw new Error(`Immutable asset ${asset} changed without changing its URL. Previous clients cannot be protected.`)
      if (options.bundleAssets !== false)
        await fromStorage(`write ${asset}`, () => storage.setItemRaw(assetKey(buildId, asset), data))
      totalBytes += data.byteLength
      return [asset, hash] as const
    })

    const now = new Date()
    const record: VersionRecord = {
      schemaVersion: VERSION_RECORD_SCHEMA,
      id: buildId,
      timestamp: now.toISOString(),
      expires: new Date(now.getTime() + retentionDays * 86400000).toISOString(),
      bundled: options.bundleAssets !== false,
      assets: Object.fromEntries(storedAssets),
    }
    await fromStorage(`write version record ${buildId}`, () => storage.setItem(recordKey(buildId), record))
    currentBuildId = buildId
    logger.debug(`${record.bundled ? 'Stored' : 'Tracked'} ${protectedAssets.length} assets (${formatBytes(totalBytes)}) for ${buildId}`)
    return record
  }

  async function cleanupExpiredVersions(activeBuildId = currentBuildId): Promise<void> {
    const records = (await getVersionRecords(storage))
      .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    const now = Date.now()
    const retainedByCount = new Set(records.slice(0, maxNumberOfVersions).map(record => record.id))
    retainedByCount.add(activeBuildId)
    const removed = records.filter(record => record.id !== activeBuildId && (
      new Date(record.expires).getTime() <= now || !retainedByCount.has(record.id)
    ))

    for (const record of removed) {
      if (record.bundled)
        await processBatch(Object.keys(record.assets), 50, asset => fromStorage(`remove ${asset}`, () => storage.removeItem(assetKey(record.id, asset))))
      await fromStorage(`remove version record ${record.id}`, () => storage.removeItem(recordKey(record.id)))
    }

    if (removed.length > 0) {
      logger.log('Removing outdated build artifacts...')
      removed.forEach((record, index) => {
        const prefix = index === removed.length - 1 ? '  └─' : '  ├─'
        logger.log(colors.gray(`${prefix} ${record.id.slice(0, 8)} (${Object.keys(record.assets).length} assets)`))
      })
    }
  }

  async function listExistingVersions(): Promise<{ id: string, createdAt: number }[]> {
    return (await getVersionRecords(storage)).map(record => ({
      id: record.id,
      createdAt: new Date(record.timestamp).getTime(),
    }))
  }

  async function restoreOldAssetsToPublic(activeBuildId: string, publicDir: string, currentAssets: string[] = []): Promise<void> {
    const startedAt = Date.now()
    const currentAssetSet = new Set(currentAssets)
    const records = (await getVersionRecords(storage)).filter(record => record.id !== activeBuildId && record.bundled)
    const tasks: Array<{ record: VersionRecord, asset: string }> = []
    const collected = new Set<string>()
    for (const record of records) {
      for (const asset of Object.keys(record.assets)) {
        if (currentAssetSet.has(asset) || collected.has(asset))
          continue
        collected.add(asset)
        tasks.push({ record, asset })
      }
    }

    const now = Date.now()
    const restored = await processBatch(tasks, 25, async ({ record, asset }) => {
      const data = await fromStorage(`read ${asset}`, () => storage.getItemRaw(assetKey(record.id, asset)))
      if (data === null)
        throw new Error(`Stored asset ${asset} for build ${record.id} is missing. Skew protection cannot be guaranteed.`)
      const buffer = toBuffer(data, `Stored asset ${asset} for build ${record.id}`)
      const actualHash = createHash('sha256').update(buffer).digest('hex')
      if (actualHash !== record.assets[asset])
        throw new Error(`Stored asset ${asset} for build ${record.id} is corrupt.`)
      const targetPath = join(publicDir, asset)
      await fs.mkdir(dirname(targetPath), { recursive: true })
      await fs.writeFile(targetPath, buffer, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST')
          throw error
      })
      return { record, asset }
    })

    const restoredByVersion = new Map<string, number>()
    restored.forEach(({ record }) => restoredByVersion.set(record.id, (restoredByVersion.get(record.id) || 0) + 1))
    records.forEach((record, index) => {
      const prefix = index === records.length - 1 ? '  └─' : '  ├─'
      logger.log(colors.gray(`${prefix} ${record.id.slice(0, 8)} (${restoredByVersion.get(record.id) || 0}/${Object.keys(record.assets).length} files restored, ${formatAge(new Date(record.timestamp).getTime(), now)})`))
    })
    logger.debug(`Restored ${restored.length} assets in ${formatDuration(Date.now() - startedAt)}`)
  }

  async function augmentBuildMetadata(buildId: string, publicDir: string, serverDir?: string): Promise<void> {
    const records = await getVersionRecords(storage)
    const versions = Object.fromEntries(records.map(record => [record.id, {
      timestamp: record.timestamp,
      expires: record.expires,
    }]))
    const latestPath = join(publicDir, buildAssetsDir, 'builds', 'latest.json')
    const latestData = await fs.readFile(latestPath, 'utf8').catch((error: unknown) => {
      throw new Error(`Nuxt app manifest is missing at ${latestPath}.`, { cause: error })
    })
    const latestJson = JSON.parse(latestData) as Record<string, unknown>
    latestJson.skewProtection = { versions }
    const newLatestContent = JSON.stringify(latestJson, null, 2)
    await fs.writeFile(latestPath, newLatestContent, 'utf8')

    const record = records.find(version => version.id === buildId)
    if (!record)
      throw new Error(`Stored version record ${buildId} is missing before metadata augmentation.`)
    const metaPath = join(publicDir, buildAssetsDir, 'builds', 'meta', `${buildId}.json`)
    const metaData = await fs.readFile(metaPath, 'utf8').catch((error: unknown) => {
      throw new Error(`Nuxt build metadata is missing at ${metaPath}.`, { cause: error })
    })
    const metaJson = JSON.parse(metaData) as Record<string, unknown>
    metaJson.skewProtection = { timestamp: record.timestamp, expires: record.expires }
    await fs.writeFile(metaPath, JSON.stringify(metaJson, null, 2), 'utf8')

    if (serverDir)
      await patchNitroManifest(serverDir, `${buildAssetsPath}/builds/latest.json`, newLatestContent)
  }

  async function patchNitroManifest(serverDir: string, assetPath: string, newContent: string): Promise<void> {
    const nitroPath = join(serverDir, 'chunks', 'nitro', 'nitro.mjs')
    let nitro = await fs.readFile(nitroPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT')
        return null
      throw error
    })
    if (!nitro)
      return
    const assetIndex = nitro.indexOf(`"${assetPath}":`)
    if (assetIndex === -1)
      return
    const start = nitro.indexOf('{', assetIndex)
    if (start === -1)
      throw new Error(`Could not locate Nitro asset metadata for ${assetPath}.`)

    let depth = 0
    let stringChar: string | null = null
    let end = -1
    for (let index = start; index < nitro.length; index++) {
      const char = nitro[index]
      if (stringChar) {
        if (char === '\\')
          index++
        else if (char === stringChar)
          stringChar = null
      }
      else if (char === '"' || char === '\'') {
        stringChar = char
      }
      else if (char === '{') {
        depth++
      }
      else if (char === '}' && --depth === 0) {
        end = index
        break
      }
    }
    if (end === -1)
      throw new Error(`Could not parse Nitro asset metadata for ${assetPath}.`)

    const size = Buffer.byteLength(newContent, 'utf8')
    const hash = createHash('sha1').update(newContent).digest('base64').substring(0, 27)
    const etag = `"${size.toString(16)}-${hash}"`
    let entry = nitro.slice(start, end + 1)
    entry = entry.replace(RE_SIZE_PROP, match => `${match.match(RE_SIZE_PREFIX)?.[0] || 'size:'}${size}`)
    entry = entry.replace(RE_ETAG_PROP, (match) => {
      const prefix = match.match(RE_ETAG_KEY_PREFIX)?.[0] || 'etag:'
      const quote = match.match(RE_ETAG_QUOTE)?.[1] || '"'
      return `${prefix}${quote}${quote === '\'' ? etag : etag.replace(RE_ESCAPE_DOUBLE_QUOTE, '\\"')}${quote}`
    })
    nitro = nitro.slice(0, start) + entry + nitro.slice(end + 1)
    await fs.writeFile(nitroPath, nitro, 'utf8')
  }

  return {
    getAssetsFromBuild,
    storeVersion,
    cleanupExpiredVersions,
    listExistingVersions,
    restoreOldAssetsToPublic,
    augmentBuildMetadata,
    getManifest: async (activeBuildId = currentBuildId) => toManifest(await getVersionRecords(storage), activeBuildId),
    dispose: () => storage.dispose(),
  }
}
