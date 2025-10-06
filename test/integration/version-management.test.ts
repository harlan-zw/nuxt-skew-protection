import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveBuildTimeDriver } from '../../src/unstorage/utils'
import { createAssetManager } from '../../src/utils/version-manager'

describe('version Management Integration', () => {
  const testDir = join(import.meta.dirname, '.tmp', 'integration-test')
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

  describe('multi-Build Lifecycle', () => {
    it('should handle complete multi-build workflow', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }),
        retentionDays: 7,
        maxNumberOfVersions: 5,
        debug: false,
      })

      // Build 1: Initial deployment
      const build1Dir = join(outputDir, 'public', '_nuxt')
      const build1BuildsDir = join(outputDir, 'public', '_nuxt', 'builds')
      await mkdir(build1BuildsDir, { recursive: true })
      await mkdir(join(build1BuildsDir, 'meta'), { recursive: true })
      await writeFile(join(build1BuildsDir, 'latest.json'), JSON.stringify({ id: 'build-1' }), 'utf-8')
      await writeFile(join(build1BuildsDir, 'meta', 'build-1.json'), JSON.stringify({ id: 'build-1' }), 'utf-8')

      await writeFile(join(build1Dir, 'entry.ABC123.js'), 'v1 entry')
      await writeFile(join(build1Dir, 'chunk-vendors.DEF456.js'), 'v1 vendors')

      const build1Assets = await manager.getAssetsFromBuild(outputDir)
      await manager.updateVersionsManifest('build-1', build1Assets)
      await manager.storeAssetsInStorage('build-1', outputDir, build1Assets)
      await manager.augmentBuildMetadata('build-1', outputDir)

      // Build 2: Update with new entry, keep vendors
      await rm(join(build1Dir, 'entry.ABC123.js'))
      await writeFile(join(build1Dir, 'entry.XYZ789.js'), 'v2 entry')
      await writeFile(join(build1BuildsDir, 'latest.json'), JSON.stringify({ id: 'build-2' }), 'utf-8')
      await writeFile(join(build1BuildsDir, 'meta', 'build-2.json'), JSON.stringify({ id: 'build-2' }), 'utf-8')

      const build2Assets = await manager.getAssetsFromBuild(outputDir)
      const { manifest: manifest2 } = await manager.updateVersionsManifest('build-2', build2Assets)
      await manager.storeAssetsInStorage('build-2', outputDir, build2Assets)
      await manager.restoreOldAssetsToPublic('build-2', outputDir, build2Assets)
      await manager.augmentBuildMetadata('build-2', outputDir)

      // Verify old entry was restored
      const oldEntryExists = await readFile(join(outputDir, 'public', '_nuxt', 'entry.ABC123.js'), 'utf-8')
        .then(() => true)
        .catch(() => false)
      expect(oldEntryExists).toBe(true)

      // Verify manifest has both versions
      expect(manifest2.versions['build-1']).toBeDefined()
      expect(manifest2.versions['build-2']).toBeDefined()

      // Verify deleted chunks tracking
      const manifestPath = join(storageDir, 'version-manifest.json')
      const manifestData = await readFile(manifestPath, 'utf-8')
      const manifest = JSON.parse(manifestData)
      expect(manifest.versions['build-2'].deletedChunks).toContain('_nuxt/entry.ABC123.js')

      // Verify build metadata augmentation
      const latestData = await readFile(join(build1BuildsDir, 'latest.json'), 'utf-8')
      const latest = JSON.parse(latestData)
      expect(latest.skewProtection).toBeDefined()
      expect(latest.skewProtection.versions['build-2']).toBeDefined()
    })

    it('should enforce retention policies across builds', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }),
        retentionDays: 30,
        maxNumberOfVersions: 3,
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      // Create 5 builds
      for (let i = 1; i <= 5; i++) {
        const asset = `_nuxt/build-${i}.ABC${i}.js`
        await writeFile(join(outputDir, 'public', asset), `build ${i}`)
        await manager.updateVersionsManifest(`build-${i}`, [asset])
        await manager.storeAssetsInStorage(`build-${i}`, outputDir, [asset])
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      // Cleanup should remove oldest builds beyond maxNumberOfVersions
      await manager.cleanupExpiredVersions()

      const versions = await manager.listExistingVersions()
      expect(versions).toHaveLength(3)

      const versionIds = versions.map(v => v.id)
      expect(versionIds).toContain('build-5') // Most recent
      expect(versionIds).toContain('build-4')
      expect(versionIds).toContain('build-3')
      expect(versionIds).not.toContain('build-2')
      expect(versionIds).not.toContain('build-1')
    })

    it('should handle deduplication across multiple builds', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }),
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      const sharedVendor = '_nuxt/vendors.SHARED123.js'
      await writeFile(join(outputDir, 'public', sharedVendor), 'shared vendors')

      // Build 1 with shared vendor
      await writeFile(join(outputDir, 'public', '_nuxt', 'entry.V1.js'), 'entry v1')
      const build1Assets = [sharedVendor, '_nuxt/entry.V1.js']
      await manager.updateVersionsManifest('build-1', build1Assets)
      await manager.storeAssetsInStorage('build-1', outputDir, build1Assets)

      // Build 2 with same shared vendor
      await rm(join(outputDir, 'public', '_nuxt', 'entry.V1.js'))
      await writeFile(join(outputDir, 'public', '_nuxt', 'entry.V2.js'), 'entry v2')
      const build2Assets = [sharedVendor, '_nuxt/entry.V2.js']
      await manager.updateVersionsManifest('build-2', build2Assets)
      await manager.storeAssetsInStorage('build-2', outputDir, build2Assets)

      // Build 3 with same shared vendor
      await rm(join(outputDir, 'public', '_nuxt', 'entry.V2.js'))
      await writeFile(join(outputDir, 'public', '_nuxt', 'entry.V3.js'), 'entry v3')
      const build3Assets = [sharedVendor, '_nuxt/entry.V3.js']
      await manager.updateVersionsManifest('build-3', build3Assets)
      await manager.storeAssetsInStorage('build-3', outputDir, build3Assets)

      const manifestPath = join(storageDir, 'version-manifest.json')
      const manifestData = await readFile(manifestPath, 'utf-8')
      const manifest = JSON.parse(manifestData)

      // Shared vendor should only be in most recent build
      expect(manifest.versions['build-1'].assets).not.toContain(sharedVendor)
      expect(manifest.versions['build-2'].assets).not.toContain(sharedVendor)
      expect(manifest.versions['build-3'].assets).toContain(sharedVendor)

      // fileIdToVersion should point to build-3
      // File ID is extracted as first segment: "vendors.SHARED123"
      expect(manifest.fileIdToVersion?.['vendors.SHARED123']).toBe('build-3')
    })
  })

  describe('storage Backends', () => {
    it('should work with filesystem storage', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }),
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      const asset = '_nuxt/test.ABC123.js'
      const assetContent = 'test content'
      await writeFile(join(outputDir, 'public', asset), assetContent)

      await manager.updateVersionsManifest('build-1', [asset])
      await manager.storeAssetsInStorage('build-1', outputDir, [asset])

      // Verify stored in filesystem
      const storedContent = await readFile(
        join(storageDir, 'build-1', asset),
        'utf-8',
      )
      expect(storedContent).toBe(assetContent)
    })

    it('should work with memory storage', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'memory' }),
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      const asset = '_nuxt/test.ABC123.js'
      await writeFile(join(outputDir, 'public', asset), 'test content')

      await manager.updateVersionsManifest('build-1', [asset])
      await manager.storeAssetsInStorage('build-1', outputDir, [asset])

      // Verify can list versions (stored in memory)
      const versions = await manager.listExistingVersions()
      expect(versions).toHaveLength(1)
      expect(versions[0].id).toBe('build-1')
    })
  })

  describe('error Handling', () => {
    it('should handle missing build output gracefully', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }),
        debug: false,
      })

      // Try to get assets from non-existent directory
      const assets = await manager.getAssetsFromBuild(join(testDir, 'non-existent'))

      expect(assets).toEqual([])
    })

    it('should handle missing storage directory gracefully', async () => {
      // Don't create storage directory - manager should handle this
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: join(testDir, 'non-existent-storage') }),
        debug: false,
      })

      // Should work even without existing storage
      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })
      await writeFile(join(nuxtDir, 'test.js'), 'test')

      const assets = await manager.getAssetsFromBuild(outputDir)

      // Should create new manifest even if storage doesn't exist yet
      const result = await manager.updateVersionsManifest('build-1', assets)

      // Should have valid manifest
      expect(result.manifest.versions['build-1']).toBeDefined()
      expect(result.manifest.current).toBe('build-1')

      // Should be able to list versions
      const versions = await manager.listExistingVersions()
      expect(versions).toHaveLength(1)
    })

    it('should skip augmentation when build files missing', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }),
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      await manager.updateVersionsManifest('build-1', ['_nuxt/test.js'])

      // Try to augment without builds directory
      await manager.augmentBuildMetadata('build-1', outputDir)

      // Should not throw error
    })
  })
})
