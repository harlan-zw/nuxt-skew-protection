import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveBuildTimeDriver } from '../../src/unstorage/utils'
import { createAssetManager } from '../../src/utils/version-manager'

describe('module Hooks', () => {
  const testDir = join(import.meta.dirname, '.tmp', 'hooks-test')
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

  describe('nitro Hook Lifecycle', () => {
    it('should execute rollup:before hook before close hook', async () => {
      const executionOrder: string[] = []
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }),
        retentionDays: 7,
        maxNumberOfVersions: 5,
        debug: false,
      })

      // Setup test build directory
      const nuxtDir = join(outputDir, 'public', '_nuxt')
      const buildsDir = join(nuxtDir, 'builds')
      await mkdir(buildsDir, { recursive: true })
      await mkdir(join(buildsDir, 'meta'), { recursive: true })
      await writeFile(join(buildsDir, 'latest.json'), JSON.stringify({ id: 'build-1' }), 'utf-8')
      await writeFile(join(buildsDir, 'meta', 'build-1.json'), JSON.stringify({ id: 'build-1' }), 'utf-8')
      await writeFile(join(nuxtDir, 'entry.ABC123.js'), 'test entry')

      // Simulate rollup:before hook
      executionOrder.push('rollup:before-start')
      const assets = await manager.getAssetsFromBuild(outputDir)
      await manager.updateVersionsManifest('build-1', assets)
      await manager.storeAssetsInStorage('build-1', outputDir, assets)
      await manager.restoreOldAssetsToPublic('build-1', outputDir, assets)
      await manager.augmentBuildMetadata('build-1', outputDir)
      executionOrder.push('rollup:before-end')

      // Simulate close hook
      executionOrder.push('close-start')
      await manager.cleanupExpiredVersions()
      executionOrder.push('close-end')

      expect(executionOrder).toEqual([
        'rollup:before-start',
        'rollup:before-end',
        'close-start',
        'close-end',
      ])
    })

    it('should initialize assetManager in rollup:before', async () => {
      let manager: ReturnType<typeof createAssetManager> | undefined

      // Simulate nitro:init setting up hooks
      const rollupBeforeHook = async () => {
        manager = createAssetManager({
          driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }),
          debug: false,
        })

        // Setup test build directory
        const nuxtDir = join(outputDir, 'public', '_nuxt')
        await mkdir(nuxtDir, { recursive: true })
        await writeFile(join(nuxtDir, 'test.ABC123.js'), 'test')

        const assets = await manager.getAssetsFromBuild(outputDir)
        await manager.updateVersionsManifest('build-1', assets)
      }

      const closeHook = async () => {
        if (manager) {
          await manager.cleanupExpiredVersions()
        }
      }

      // Before rollup:before, manager is undefined
      expect(manager).toBeUndefined()

      // Execute rollup:before
      await rollupBeforeHook()

      // After rollup:before, manager is defined
      expect(manager).toBeDefined()

      // Execute close hook with defined manager
      await closeHook()

      // Should not throw
    })

    it('should share assetManager instance between hooks via closure', async () => {
      let capturedManager: ReturnType<typeof createAssetManager> | undefined

      // Setup test build
      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })
      await writeFile(join(nuxtDir, 'test.ABC123.js'), 'test')

      // Simulate module hook closure pattern
      const setupHooks = () => {
        let assetManager: ReturnType<typeof createAssetManager>

        const rollupBefore = async () => {
          assetManager = createAssetManager({
            driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }),
            debug: false,
          })
          capturedManager = assetManager
          const assets = await assetManager.getAssetsFromBuild(outputDir)
          await assetManager.updateVersionsManifest('build-1', assets)
        }

        const close = async () => {
          if (assetManager) {
            await assetManager.cleanupExpiredVersions()
          }
        }

        return { rollupBefore, close }
      }

      const hooks = setupHooks()
      await hooks.rollupBefore()

      // Verify manager was created and captured
      expect(capturedManager).toBeDefined()

      // close hook should access same manager instance
      await hooks.close()
    })
  })

  describe('rollup:before Hook', () => {
    it('should cache previous build files', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }),
        debug: false,
      })

      // Build 1
      const nuxtDir = join(outputDir, 'public', '_nuxt')
      const buildsDir = join(nuxtDir, 'builds')
      await mkdir(buildsDir, { recursive: true })
      await mkdir(join(buildsDir, 'meta'), { recursive: true })
      await writeFile(join(buildsDir, 'latest.json'), JSON.stringify({ id: 'build-1' }), 'utf-8')
      await writeFile(join(buildsDir, 'meta', 'build-1.json'), JSON.stringify({ id: 'build-1' }), 'utf-8')
      await writeFile(join(nuxtDir, 'entry.ABC123.js'), 'v1 entry')

      const assets = await manager.getAssetsFromBuild(outputDir)
      await manager.updateVersionsManifest('build-1', assets)
      await manager.storeAssetsInStorage('build-1', outputDir, assets)

      // Verify files cached in storage
      const versions = await manager.listExistingVersions()
      expect(versions).toHaveLength(1)
      expect(versions[0].id).toBe('build-1')
    })

    it('should write to latest.json in rollup:before', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }),
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      const buildsDir = join(nuxtDir, 'builds')
      await mkdir(buildsDir, { recursive: true })
      await mkdir(join(buildsDir, 'meta'), { recursive: true })
      await writeFile(join(buildsDir, 'latest.json'), JSON.stringify({ id: 'build-1' }), 'utf-8')
      await writeFile(join(buildsDir, 'meta', 'build-1.json'), JSON.stringify({ id: 'build-1' }), 'utf-8')
      await writeFile(join(nuxtDir, 'entry.ABC123.js'), 'v1 entry')

      const assets = await manager.getAssetsFromBuild(outputDir)
      await manager.updateVersionsManifest('build-1', assets)
      await manager.storeAssetsInStorage('build-1', outputDir, assets)
      await manager.augmentBuildMetadata('build-1', outputDir)

      // Verify latest.json was augmented
      const latestPath = join(buildsDir, 'latest.json')
      const { readFile } = await import('node:fs/promises')
      const latestData = await readFile(latestPath, 'utf-8')
      const latest = JSON.parse(latestData)

      expect(latest.skewProtection).toBeDefined()
      expect(latest.skewProtection.versions['build-1']).toBeDefined()
    })

    it('should restore old assets during rollup:before', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }),
        debug: false,
      })

      // Build 1
      const nuxtDir = join(outputDir, 'public', '_nuxt')
      const buildsDir = join(nuxtDir, 'builds')
      await mkdir(buildsDir, { recursive: true })
      await mkdir(join(buildsDir, 'meta'), { recursive: true })
      await writeFile(join(buildsDir, 'latest.json'), JSON.stringify({ id: 'build-1' }), 'utf-8')
      await writeFile(join(buildsDir, 'meta', 'build-1.json'), JSON.stringify({ id: 'build-1' }), 'utf-8')
      await writeFile(join(nuxtDir, 'entry.OLD123.js'), 'old entry')

      const build1Assets = await manager.getAssetsFromBuild(outputDir)
      await manager.updateVersionsManifest('build-1', build1Assets)
      await manager.storeAssetsInStorage('build-1', outputDir, build1Assets)

      // Build 2
      await rm(join(nuxtDir, 'entry.OLD123.js'))
      await writeFile(join(nuxtDir, 'entry.NEW456.js'), 'new entry')
      await writeFile(join(buildsDir, 'latest.json'), JSON.stringify({ id: 'build-2' }), 'utf-8')
      await writeFile(join(buildsDir, 'meta', 'build-2.json'), JSON.stringify({ id: 'build-2' }), 'utf-8')

      const build2Assets = await manager.getAssetsFromBuild(outputDir)
      await manager.updateVersionsManifest('build-2', build2Assets)
      await manager.storeAssetsInStorage('build-2', outputDir, build2Assets)
      await manager.restoreOldAssetsToPublic('build-2', outputDir, build2Assets)

      // Verify old entry was restored
      const { readFile } = await import('node:fs/promises')
      const oldEntry = await readFile(join(nuxtDir, 'entry.OLD123.js'), 'utf-8')
      expect(oldEntry).toBe('old entry')
    })
  })

  describe('close Hook', () => {
    it('should cleanup expired versions on close', async () => {
      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }),
        retentionDays: 30,
        maxNumberOfVersions: 2,
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      await mkdir(nuxtDir, { recursive: true })

      // Create 4 builds
      for (let i = 1; i <= 4; i++) {
        const asset = `_nuxt/build-${i}.ABC${i}.js`
        await writeFile(join(outputDir, 'public', asset), `build ${i}`)
        await manager.updateVersionsManifest(`build-${i}`, [asset])
        await manager.storeAssetsInStorage(`build-${i}`, outputDir, [asset])
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      // Before cleanup
      let versions = await manager.listExistingVersions()
      expect(versions).toHaveLength(4)

      // Simulate close hook
      await manager.cleanupExpiredVersions()

      // After cleanup - should keep only 2 most recent
      versions = await manager.listExistingVersions()
      expect(versions).toHaveLength(2)

      const versionIds = versions.map(v => v.id)
      expect(versionIds).toContain('build-4')
      expect(versionIds).toContain('build-3')
      expect(versionIds).not.toContain('build-2')
      expect(versionIds).not.toContain('build-1')
    })

    it('should handle close hook when assetManager is undefined', async () => {
      let assetManager: ReturnType<typeof createAssetManager> | undefined

      const closeHook = async () => {
        if (assetManager) {
          await assetManager.cleanupExpiredVersions()
        }
      }

      // Should not throw when manager is undefined
      await expect(closeHook()).resolves.toBeUndefined()
    })
  })

  describe('hook Timing', () => {
    it('should allow caching in rollup:before before finalization', async () => {
      const operations: string[] = []

      const manager = createAssetManager({
        driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }),
        debug: false,
      })

      const nuxtDir = join(outputDir, 'public', '_nuxt')
      const buildsDir = join(nuxtDir, 'builds')
      await mkdir(buildsDir, { recursive: true })
      await mkdir(join(buildsDir, 'meta'), { recursive: true })
      await writeFile(join(buildsDir, 'latest.json'), JSON.stringify({ id: 'build-1' }), 'utf-8')
      await writeFile(join(buildsDir, 'meta', 'build-1.json'), JSON.stringify({ id: 'build-1' }), 'utf-8')
      await writeFile(join(nuxtDir, 'entry.ABC123.js'), 'test')

      // Simulate rollup:before operations
      operations.push('get-assets')
      await manager.getAssetsFromBuild(outputDir)

      operations.push('update-manifest')
      await manager.updateVersionsManifest('build-1', ['_nuxt/entry.ABC123.js'])

      operations.push('store-assets')
      await manager.storeAssetsInStorage('build-1', outputDir, ['_nuxt/entry.ABC123.js'])

      operations.push('augment-metadata')
      await manager.augmentBuildMetadata('build-1', outputDir)

      // Verify operation order
      expect(operations).toEqual([
        'get-assets',
        'update-manifest',
        'store-assets',
        'augment-metadata',
      ])
    })
  })
})
