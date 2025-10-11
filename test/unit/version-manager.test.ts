import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveBuildTimeDriver } from '../../src/unstorage/utils'
import { createAssetManager } from '../../src/utils/version-manager'

describe('version Manager', () => {
  const testDir = join(import.meta.dirname, '.tmp', 'version-manager-test')
  const storageDir = join(testDir, 'storage')
  const outputDir = join(testDir, 'output')

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true })
    await mkdir(testDir, { recursive: true })
    await mkdir(storageDir, { recursive: true })
    await mkdir(outputDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe('asset Collection', () => {
    it('should collect all assets from build output', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: false, rootDir: testDir }),
        debug: false,
      })

      // Create mock build output
      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })
      await writeFile(join(nuxtDir, 'entry.ABC123.js'), 'console.log("entry")')
      await writeFile(join(nuxtDir, 'chunk-vendors.DEF456.js'), 'console.log("vendors")')

      const assets = await manager.getAssetsFromBuild(outputDir)

      expect(assets).toContain('_nuxt/entry.ABC123.js')
      expect(assets).toContain('_nuxt/chunk-vendors.DEF456.js')
      expect(assets).toHaveLength(2)
    })

    it('should handle nested directories', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: false, rootDir: testDir }),
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(join(nuxtDir, 'components'), { recursive: true })
      await writeFile(join(nuxtDir, 'entry.ABC123.js'), 'entry')
      await writeFile(join(nuxtDir, 'components', 'Button.XYZ789.js'), 'button')

      const assets = await manager.getAssetsFromBuild(outputDir)

      expect(assets).toContain('_nuxt/entry.ABC123.js')
      expect(assets).toContain('_nuxt/components/Button.XYZ789.js')
      expect(assets).toHaveLength(2)
    })

    it('should return empty array when no assets exist', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: false, rootDir: testDir }),
        debug: false,
      })

      await mkdir(join(outputDir, 'public', '_nuxt'), { recursive: true })

      const assets = await manager.getAssetsFromBuild(outputDir)

      expect(assets).toEqual([])
    })
  })

  describe('version Manifest Updates', () => {
    it('should create new version in manifest', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: false, rootDir: testDir }),
        retentionDays: 7,
        debug: false,
      })

      const buildId = 'build-123'
      const assets = ['_nuxt/entry.ABC123.js', '_nuxt/chunk.DEF456.js']

      const result = await manager.updateVersionsManifest(buildId, assets)

      expect(result.manifest.current).toBe(buildId)
      expect(result.manifest.versions[buildId]).toBeDefined()
      expect(result.manifest.versions[buildId].timestamp).toBeDefined()
      expect(result.isExistingVersion).toBe(false)
    })

    it('should detect existing version', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: false, rootDir: testDir }),
        debug: false,
      })

      const buildId = 'build-123'
      const assets = ['_nuxt/entry.ABC123.js']

      // First update
      await manager.updateVersionsManifest(buildId, assets)

      // Second update with same buildId
      const result = await manager.updateVersionsManifest(buildId, assets)

      expect(result.isExistingVersion).toBe(true)
    })

    it('should set correct expiration date', async () => {
      const retentionDays = 14
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: false, rootDir: testDir }),
        retentionDays,
        debug: false,
      })

      const buildId = 'build-123'
      const assets = ['_nuxt/entry.ABC123.js']

      const result = await manager.updateVersionsManifest(buildId, assets)

      const timestamp = new Date(result.manifest.versions[buildId]!.timestamp)
      const expires = new Date(result.manifest.versions[buildId]!.expires)
      const diffDays = Math.floor((expires.getTime() - timestamp.getTime()) / (1000 * 60 * 60 * 24))

      expect(diffDays).toBe(retentionDays)
    })
  })

  describe('deleted Chunks Calculation', () => {
    it('should calculate deleted chunks between versions', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: false, rootDir: testDir }),
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      // Version 1 with 3 assets
      const v1Assets = ['_nuxt/entry.ABC123.js', '_nuxt/chunk-a.DEF456.js', '_nuxt/chunk-b.GHI789.js']
      for (const asset of v1Assets) {
        await writeFile(join(outputDir, 'public', asset), 'content')
      }
      await manager.updateVersionsManifest('v1', v1Assets)
      await manager.storeAssetsInStorage('v1', outputDir, v1Assets)

      // Version 2 removes chunk-a, keeps entry and chunk-b
      const v2Assets = ['_nuxt/entry.ABC123.js', '_nuxt/chunk-b.GHI789.js']
      for (const asset of v2Assets) {
        await writeFile(join(outputDir, 'public', asset), 'content')
      }
      await manager.updateVersionsManifest('v2', v2Assets)
      await manager.storeAssetsInStorage('v2', outputDir, v2Assets)

      // Re-read manifest to get updated deletedChunks
      const manifestPath = join(storageDir, 'version-manifest.json')
      const manifestData = await readFile(manifestPath, 'utf-8')
      const updatedManifest = JSON.parse(manifestData)

      expect(updatedManifest.versions.v2.deletedChunks).toContain('_nuxt/chunk-a.DEF456.js')
      expect(updatedManifest.versions.v2.deletedChunks).not.toContain('_nuxt/entry.ABC123.js')
      expect(updatedManifest.versions.v2.deletedChunks).not.toContain('_nuxt/chunk-b.GHI789.js')
    })

    it('should have empty deletedChunks for first version', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: false, rootDir: testDir }),
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      const assets = ['_nuxt/entry.ABC123.js']
      for (const asset of assets) {
        await writeFile(join(outputDir, 'public', asset), 'content')
      }

      await manager.updateVersionsManifest('v1', assets)
      await manager.storeAssetsInStorage('v1', outputDir, assets)

      const manifestPath = join(storageDir, 'version-manifest.json')
      const manifestData = await readFile(manifestPath, 'utf-8')
      const manifest = JSON.parse(manifestData)

      expect(manifest.versions.v1.deletedChunks).toEqual([])
    })
  })

  describe('asset Storage and Deduplication', () => {
    it('should store assets in storage', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: false, rootDir: testDir }),
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      const buildId = 'build-123'
      const assetContent = 'console.log("test")'
      await writeFile(join(nuxtDir, 'entry.ABC123.js'), assetContent)

      const assets = ['_nuxt/entry.ABC123.js']
      await manager.updateVersionsManifest(buildId, assets)
      await manager.storeAssetsInStorage(buildId, outputDir, assets)

      // Verify asset is stored
      const storedAsset = await readFile(
        join(storageDir, buildId, '_nuxt', 'entry.ABC123.js'),
        'utf-8',
      )
      expect(storedAsset).toBe(assetContent)
    })

    it('should deduplicate assets across versions', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: false, rootDir: testDir }),
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      // Version 1 with vendor chunk
      const sharedAsset = '_nuxt/vendors.ABC123.js'
      await writeFile(join(outputDir, 'public', sharedAsset), 'shared content')
      await manager.updateVersionsManifest('v1', [sharedAsset])
      await manager.storeAssetsInStorage('v1', outputDir, [sharedAsset])

      // Version 2 with same vendor chunk (same hash)
      await manager.updateVersionsManifest('v2', [sharedAsset])
      await manager.storeAssetsInStorage('v2', outputDir, [sharedAsset])

      // Read manifest to check deduplication
      const manifestPath = join(storageDir, 'version-manifest.json')
      const manifestData = await readFile(manifestPath, 'utf-8')
      const manifest = JSON.parse(manifestData)

      // v1 should have had the asset removed from its list
      expect(manifest.versions.v1.assets).not.toContain(sharedAsset)
      // v2 should have the asset
      expect(manifest.versions.v2.assets).toContain(sharedAsset)
      // fileIdToVersion should point to v2
      // File ID format is: vendors.ABC123 (first segment + extension from filename pattern)
      expect(manifest.fileIdToVersion?.['vendors.ABC123']).toBe('v2')
    })

    it('should handle assets with different hashes', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: false, rootDir: testDir }),
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      // Version 1 with entry
      const v1Asset = '_nuxt/entry.ABC123.js'
      await writeFile(join(outputDir, 'public', v1Asset), 'v1 content')
      await manager.updateVersionsManifest('v1', [v1Asset])
      await manager.storeAssetsInStorage('v1', outputDir, [v1Asset])

      // Version 2 with different hash for entry
      const v2Asset = '_nuxt/entry.XYZ789.js'
      await writeFile(join(outputDir, 'public', v2Asset), 'v2 content')
      await manager.updateVersionsManifest('v2', [v2Asset])
      await manager.storeAssetsInStorage('v2', outputDir, [v2Asset])

      // Both should be stored since they have different file IDs
      const manifestPath = join(storageDir, 'version-manifest.json')
      const manifestData = await readFile(manifestPath, 'utf-8')
      const manifest = JSON.parse(manifestData)

      expect(manifest.versions.v1.assets).toContain(v1Asset)
      expect(manifest.versions.v2.assets).toContain(v2Asset)
    })
  })

  describe('restoring Old Assets', () => {
    it('should restore old assets to public directory', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: false, rootDir: testDir }),
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      // Version 1
      const v1Asset = '_nuxt/old-chunk.ABC123.js'
      await writeFile(join(outputDir, 'public', v1Asset), 'old content')
      await manager.updateVersionsManifest('v1', [v1Asset])
      await manager.storeAssetsInStorage('v1', outputDir, [v1Asset])

      // Version 2 (different asset)
      const v2Asset = '_nuxt/new-chunk.XYZ789.js'
      await writeFile(join(outputDir, 'public', v2Asset), 'new content')
      await manager.updateVersionsManifest('v2', [v2Asset])
      await manager.storeAssetsInStorage('v2', outputDir, [v2Asset])

      // Remove old asset from public (simulating new build)
      await rm(join(outputDir, 'public', v1Asset), { force: true })

      // Restore old assets
      await manager.restoreOldAssetsToPublic('v2', outputDir, [v2Asset])

      // Old asset should be restored
      const restoredContent = await readFile(join(outputDir, 'public', v1Asset), 'utf-8')
      expect(restoredContent).toBe('old content')
    })

    it('should skip restoring assets with same file ID', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: false, rootDir: testDir }),
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      // Version 1 with vendor chunk - fileId will be "vendors.ABC123"
      const v1Asset = '_nuxt/vendors.ABC123.js'
      await writeFile(join(outputDir, 'public', v1Asset), 'v1 vendors')
      await manager.updateVersionsManifest('v1', [v1Asset])
      await manager.storeAssetsInStorage('v1', outputDir, [v1Asset])

      // Version 2 with same file ID (vendors.ABC123) but in different path format
      // Since both extract to fileId "vendors.ABC123", v2 should replace v1 in storage
      const v2Asset = '_nuxt/vendors.ABC123.mjs' // Different extension = different file ID
      await writeFile(join(outputDir, 'public', v2Asset), 'v2 vendors')
      await manager.updateVersionsManifest('v2', [v2Asset])
      await manager.storeAssetsInStorage('v2', outputDir, [v2Asset])

      await manager.restoreOldAssetsToPublic('v2', outputDir, [v2Asset])

      // v1 asset should be restored because v2 has different extension (different file ID)
      const v1Exists = await readFile(join(outputDir, 'public', v1Asset), 'utf-8')
        .then(() => true)
        .catch(() => false)

      expect(v1Exists).toBe(true)
    })

    it('should skip restoration when version already existed', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: true, rootDir: testDir }),
        debug: true,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      const asset = '_nuxt/entry.ABC123.js'
      await writeFile(join(outputDir, 'public', asset), 'content')

      // First build
      await manager.updateVersionsManifest('v1', [asset])
      await manager.storeAssetsInStorage('v1', outputDir, [asset])

      // Rebuild same version
      const result2 = await manager.updateVersionsManifest('v1', [asset])

      // Should detect as existing version
      expect(result2.isExistingVersion).toBe(true)

      // Restoration should be skipped
      await manager.restoreOldAssetsToPublic('v1', outputDir, [asset], result2.isExistingVersion)
      // No error should occur
    })
  })

  describe('expired Version Cleanup', () => {
    it('should remove versions older than retention days', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: false, rootDir: testDir }),
        retentionDays: 7,
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      // Create old version with manipulated timestamp
      const oldAsset = '_nuxt/old.ABC123.js'
      await writeFile(join(outputDir, 'public', oldAsset), 'old')
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) // 10 days ago

      // Manually create old version
      const { manifest } = await manager.updateVersionsManifest('old-v1', [oldAsset])
      manifest.versions['old-v1'].timestamp = oldDate.toISOString()
      await manager.storeAssetsInStorage('old-v1', outputDir, [oldAsset])

      // Save modified manifest
      const manifestPath = join(storageDir, 'version-manifest.json')
      await writeFile(manifestPath, JSON.stringify(manifest), 'utf-8')

      // Create current version
      const currentAsset = '_nuxt/current.XYZ789.js'
      await writeFile(join(outputDir, 'public', currentAsset), 'current')
      await manager.updateVersionsManifest('current-v1', [currentAsset])
      await manager.storeAssetsInStorage('current-v1', outputDir, [currentAsset])

      // Cleanup
      await manager.cleanupExpiredVersions()

      // Read manifest
      const updatedManifestData = await readFile(manifestPath, 'utf-8')
      const updatedManifest = JSON.parse(updatedManifestData)

      // Old version should be removed
      expect(updatedManifest.versions['old-v1']).toBeUndefined()
      // Current version should remain
      expect(updatedManifest.versions['current-v1']).toBeDefined()
    })

    it('should remove versions exceeding max count', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: false, rootDir: testDir }),
        retentionDays: 30,
        maxNumberOfVersions: 3,
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      // Create 5 versions
      for (let i = 1; i <= 5; i++) {
        const asset = `_nuxt/version-${i}.ABC${i}.js`
        await writeFile(join(outputDir, 'public', asset), `v${i}`)
        await manager.updateVersionsManifest(`v${i}`, [asset])
        await manager.storeAssetsInStorage(`v${i}`, outputDir, [asset])

        // Small delay to ensure timestamp ordering
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      await manager.cleanupExpiredVersions()

      const manifestPath = join(storageDir, 'version-manifest.json')
      const manifestData = await readFile(manifestPath, 'utf-8')
      const manifest = JSON.parse(manifestData)

      // Should only keep 3 most recent versions
      expect(Object.keys(manifest.versions)).toHaveLength(3)
      expect(manifest.versions.v5).toBeDefined() // Most recent
      expect(manifest.versions.v4).toBeDefined()
      expect(manifest.versions.v3).toBeDefined()
      expect(manifest.versions.v2).toBeUndefined()
      expect(manifest.versions.v1).toBeUndefined()
    })

    it('should never remove current version', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: false, rootDir: testDir }),
        retentionDays: 0, // Expired immediately
        maxNumberOfVersions: 1,
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      const asset = '_nuxt/current.ABC123.js'
      await writeFile(join(outputDir, 'public', asset), 'current')
      await manager.updateVersionsManifest('current-v1', [asset])
      await manager.storeAssetsInStorage('current-v1', outputDir, [asset])

      await manager.cleanupExpiredVersions()

      const manifestPath = join(storageDir, 'version-manifest.json')
      const manifestData = await readFile(manifestPath, 'utf-8')
      const manifest = JSON.parse(manifestData)

      // Current version should never be removed
      expect(manifest.versions['current-v1']).toBeDefined()
    })
  })

  describe('build Metadata Augmentation', () => {
    it('should augment builds/latest.json', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: false, rootDir: testDir }),
        debug: false,
      })

      const buildsDir = join(outputDir, 'public', '_nuxt', 'builds')
      await mkdir(buildsDir, { recursive: true })

      // Create initial latest.json
      const latestPath = join(buildsDir, 'latest.json')
      await writeFile(latestPath, JSON.stringify({ id: 'build-123' }), 'utf-8')

      const assets = ['_nuxt/entry.ABC123.js']
      await manager.updateVersionsManifest('build-123', assets)
      await manager.augmentBuildMetadata('build-123', outputDir)

      const augmentedData = await readFile(latestPath, 'utf-8')
      const augmented = JSON.parse(augmentedData)

      expect(augmented.skewProtection).toBeDefined()
      expect(augmented.skewProtection.versions).toBeDefined()
      expect(augmented.skewProtection.versions['build-123']).toBeDefined()
    })

    it('should augment builds/meta/{buildId}.json', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: false, rootDir: testDir }),
        debug: false,
      })

      const metaDir = join(outputDir, 'public', '_nuxt', 'builds', 'meta')
      await mkdir(metaDir, { recursive: true })

      const buildId = 'build-123'
      const metaPath = join(metaDir, `${buildId}.json`)
      await writeFile(metaPath, JSON.stringify({ id: buildId }), 'utf-8')

      const assets = ['_nuxt/entry.ABC123.js']
      await manager.updateVersionsManifest(buildId, assets)
      await manager.storeAssetsInStorage(buildId, outputDir, assets)
      await manager.augmentBuildMetadata(buildId, outputDir)

      const augmentedData = await readFile(metaPath, 'utf-8')
      const augmented = JSON.parse(augmentedData)

      expect(augmented.skewProtection).toBeDefined()
      expect(augmented.skewProtection.deletedChunks).toBeDefined()
      expect(augmented.skewProtection.timestamp).toBeDefined()
    })
  })

  describe('list Existing Versions', () => {
    it('should list all versions with timestamps', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: false, rootDir: testDir }),
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      // Create multiple versions
      for (let i = 1; i <= 3; i++) {
        const asset = `_nuxt/v${i}.ABC${i}.js`
        await writeFile(join(outputDir, 'public', asset), `v${i}`)
        await manager.updateVersionsManifest(`v${i}`, [asset])
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      const versions = await manager.listExistingVersions()

      expect(versions).toHaveLength(3)
      expect(versions.every(v => v.id && typeof v.createdAt === 'number')).toBe(true)
      expect(versions.map(v => v.id)).toContain('v1')
      expect(versions.map(v => v.id)).toContain('v2')
      expect(versions.map(v => v.id)).toContain('v3')
    })

    it('should return empty array when no versions exist', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }, { debug: false, rootDir: testDir }),
        debug: false,
      })

      const versions = await manager.listExistingVersions()

      expect(versions).toEqual([])
    })
  })
})
