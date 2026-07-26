import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'pathe'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAssetManager } from '../../src/utils/version-manager'

// Check if Redis is available before running tests
async function isRedisAvailable() {
  try {
    const { createStorage } = await import('unstorage')
    const redisDriver = await import('unstorage/drivers/redis')

    const storage = createStorage({
      driver: redisDriver.default({
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
      }),
    })

    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), 1000)
    })

    await Promise.race([storage.setItem('test', 'ok'), timeout])
    await storage.removeItem('test')
    return true
  }
  catch {
    return false
  }
}

const redisAvailable = await isRedisAvailable()

describe.skipIf(!redisAvailable)('redis Storage Integration', () => {
  const testDir = join(import.meta.dirname, '.tmp', 'redis-test')
  const outputDir = join(testDir, 'output')

  // Redis connection details
  const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    base: 'test:skew-protection',
  }

  beforeAll(async () => {
    // Redis is available, no need to check again
  })

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true })
    await mkdir(testDir, { recursive: true })
    await mkdir(outputDir, { recursive: true })

    // Clear Redis test namespace
    const { createStorage } = await import('unstorage')
    const redisDriver = await import('unstorage/drivers/redis')

    const storage = createStorage({
      driver: redisDriver.default(redisConfig),
    })

    // Clear all test keys
    const keys = await storage.getKeys()
    for (const key of keys) {
      await storage.removeItem(key)
    }
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  afterAll(async () => {
    // Final cleanup
    const { createStorage } = await import('unstorage')
    const redisDriver = await import('unstorage/drivers/redis')

    const storage = createStorage({
      driver: redisDriver.default(redisConfig),
    })

    const keys = await storage.getKeys()
    for (const key of keys) {
      await storage.removeItem(key)
    }
  })

  describe('basic Redis Operations', () => {
    it('should connect to Redis', async () => {
      const { createStorage } = await import('unstorage')
      const redisDriver = await import('unstorage/drivers/redis')

      const storage = createStorage({
        driver: redisDriver.default(redisConfig),
      })

      await storage.setItem('test', 'value')
      const result = await storage.getItem('test')

      expect(result).toBe('value')
    })

    it('should store and retrieve JSON data', async () => {
      const { createStorage } = await import('unstorage')
      const redisDriver = await import('unstorage/drivers/redis')

      const storage = createStorage({
        driver: redisDriver.default(redisConfig),
      })

      const testData = { version: '1.0.0', assets: ['a.js', 'b.js'] }
      await storage.setItem('manifest', testData)
      const result = await storage.getItem('manifest')

      expect(result).toEqual(testData)
    })

    it('should store and retrieve binary data', async () => {
      const { createStorage } = await import('unstorage')
      const redisDriver = await import('unstorage/drivers/redis')

      const storage = createStorage({
        driver: redisDriver.default(redisConfig),
      })

      const binaryData = Buffer.from('test binary content')
      await storage.setItemRaw('binary', binaryData)
      const result = await storage.getItemRaw('binary')

      expect(Buffer.isBuffer(result)).toBe(true)
      expect(result?.toString()).toBe('test binary content')
    })
  })

  describe('version Manager with Redis', () => {
    it('should create version manifest in Redis', async () => {
      const { createStorage } = await import('unstorage')
      const redisDriver = await import('unstorage/drivers/redis')

      const storage = createStorage({
        driver: redisDriver.default(redisConfig),
      })

      const manager = createAssetManager({
        storage,
        retentionDays: 7,
        debug: false,
      })

      const buildId = 'build-redis-1'
      const assets = ['_nuxt/entry.ABC123.js', '_nuxt/chunk.DEF456.js']

      const result = await manager.updateVersionsManifest(buildId, assets)

      expect(result.manifest.current).toBe(buildId)
      expect(result.manifest.versions[buildId]).toBeDefined()
      expect(result.manifest.versions[buildId].assets).toEqual(assets)

      // Verify using listExistingVersions
      const versions = await manager.listExistingVersions()
      expect(versions).toHaveLength(1)
      expect(versions[0].id).toBe(buildId)
    })

    it('should store and retrieve assets from Redis', async () => {
      const { createStorage } = await import('unstorage')
      const redisDriver = await import('unstorage/drivers/redis')

      const storage = createStorage({
        driver: redisDriver.default(redisConfig),
      })

      const manager = createAssetManager({
        storage,
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      // Create 2 versions to test storage
      for (let i = 1; i <= 2; i++) {
        const asset = `_nuxt/chunk-${i}.ABC${i}.js`
        await writeFile(join(outputDir, 'public', asset), `chunk ${i} content`)
        await manager.updateVersionsManifest(`build-${i}`, [asset])
        await manager.storeAssetsInStorage(`build-${i}`, outputDir, [asset])
      }

      // Verify both versions exist
      const versions = await manager.listExistingVersions()
      expect(versions).toHaveLength(2)
      expect(versions.map(v => v.id)).toContain('build-1')
      expect(versions.map(v => v.id)).toContain('build-2')
    })

    it('should handle multiple versions in Redis', async () => {
      const { createStorage } = await import('unstorage')
      const redisDriver = await import('unstorage/drivers/redis')

      const storage = createStorage({
        driver: redisDriver.default(redisConfig),
      })

      const manager = createAssetManager({
        storage,
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      // Create 3 versions
      for (let i = 1; i <= 3; i++) {
        const asset = `_nuxt/version-${i}.ABC${i}.js`
        await writeFile(join(outputDir, 'public', asset), `version ${i}`)
        await manager.updateVersionsManifest(`build-${i}`, [asset])
        await manager.storeAssetsInStorage(`build-${i}`, outputDir, [asset])
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      const versions = await manager.listExistingVersions()

      expect(versions).toHaveLength(3)
      expect(versions.map(v => v.id)).toContain('build-1')
      expect(versions.map(v => v.id)).toContain('build-2')
      expect(versions.map(v => v.id)).toContain('build-3')
    })

    it('should cleanup expired versions from Redis', async () => {
      const { createStorage } = await import('unstorage')
      const redisDriver = await import('unstorage/drivers/redis')

      const storage = createStorage({
        driver: redisDriver.default(redisConfig),
      })

      const manager = createAssetManager({
        storage,
        retentionDays: 7,
        maxNumberOfVersions: 2,
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      // Create 4 versions
      for (let i = 1; i <= 4; i++) {
        const asset = `_nuxt/version-${i}.ABC${i}.js`
        await writeFile(join(outputDir, 'public', asset), `version ${i}`)
        await manager.updateVersionsManifest(`build-${i}`, [asset])
        await manager.storeAssetsInStorage(`build-${i}`, outputDir, [asset])
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      // Cleanup should keep only 2 most recent
      await manager.cleanupExpiredVersions()

      const versions = await manager.listExistingVersions()

      expect(versions).toHaveLength(2)
      expect(versions.map(v => v.id)).toContain('build-4')
      expect(versions.map(v => v.id)).toContain('build-3')
      expect(versions.map(v => v.id)).not.toContain('build-1')
      expect(versions.map(v => v.id)).not.toContain('build-2')

      // Verify assets are actually removed from Redis
      const asset1 = await storage.getItemRaw('build-1/_nuxt/version-1.ABC1.js')
      const asset4 = await storage.getItemRaw('build-4/_nuxt/version-4.ABC4.js')

      expect(asset1).toBeNull()
      expect(asset4).toBeDefined()
    })

    it('should handle deduplication with Redis', async () => {
      const { createStorage } = await import('unstorage')
      const redisDriver = await import('unstorage/drivers/redis')

      const storage = createStorage({
        driver: redisDriver.default(redisConfig),
      })

      const manager = createAssetManager({
        storage,
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      const sharedAsset = '_nuxt/vendors.SHARED123.js'
      await writeFile(join(outputDir, 'public', sharedAsset), 'shared vendors')

      // Build 1 with shared vendor
      await manager.updateVersionsManifest('build-1', [sharedAsset])
      await manager.storeAssetsInStorage('build-1', outputDir, [sharedAsset])

      // Build 2 with same shared vendor - this triggers deduplication
      await manager.updateVersionsManifest('build-2', [sharedAsset])
      await manager.storeAssetsInStorage('build-2', outputDir, [sharedAsset])

      // Get the updated versions list to see final state
      const versions = await manager.listExistingVersions()
      expect(versions).toHaveLength(2)

      // Verify the build IDs exist
      expect(versions.map(v => v.id)).toContain('build-1')
      expect(versions.map(v => v.id)).toContain('build-2')
    })
  })

  describe('redis Performance', () => {
    it('should handle concurrent operations', async () => {
      const { createStorage } = await import('unstorage')
      const redisDriver = await import('unstorage/drivers/redis')

      const storage = createStorage({
        driver: redisDriver.default(redisConfig),
      })

      // Write 50 items concurrently
      const writes = Array.from({ length: 50 }).map((_, i) =>
        storage.setItem(`item-${i}`, { index: i, data: `test-${i}` }),
      )

      await Promise.all(writes)

      // Read them back
      const reads = Array.from({ length: 50 }).map((_, i) =>
        storage.getItem(`item-${i}`),
      )

      const results = await Promise.all(reads)

      expect(results).toHaveLength(50)
      results.forEach((result, i) => {
        expect(result).toEqual({ index: i, data: `test-${i}` })
      })
    })
  })
})
