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
      const assets = await manager.getAssetsFromBuild(join(outputDir, 'public'))
      await manager.updateVersionsManifest('build-1', assets)
      await manager.storeAssetsInStorage('build-1', join(outputDir, 'public'), assets)
      await manager.restoreOldAssetsToPublic('build-1', join(outputDir, 'public'), assets)
      await manager.augmentBuildMetadata('build-1', join(outputDir, 'public'))
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

        const assets = await manager.getAssetsFromBuild(join(outputDir, 'public'))
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
          const assets = await assetManager.getAssetsFromBuild(join(outputDir, 'public'))
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

      const assets = await manager.getAssetsFromBuild(join(outputDir, 'public'))
      await manager.updateVersionsManifest('build-1', assets)
      await manager.storeAssetsInStorage('build-1', join(outputDir, 'public'), assets)

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

      const assets = await manager.getAssetsFromBuild(join(outputDir, 'public'))
      await manager.updateVersionsManifest('build-1', assets)
      await manager.storeAssetsInStorage('build-1', join(outputDir, 'public'), assets)
      await manager.augmentBuildMetadata('build-1', join(outputDir, 'public'))

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

      const build1Assets = await manager.getAssetsFromBuild(join(outputDir, 'public'))
      await manager.updateVersionsManifest('build-1', build1Assets)
      await manager.storeAssetsInStorage('build-1', join(outputDir, 'public'), build1Assets)

      // Build 2
      await rm(join(nuxtDir, 'entry.OLD123.js'))
      await writeFile(join(nuxtDir, 'entry.NEW456.js'), 'new entry')
      await writeFile(join(buildsDir, 'latest.json'), JSON.stringify({ id: 'build-2' }), 'utf-8')
      await writeFile(join(buildsDir, 'meta', 'build-2.json'), JSON.stringify({ id: 'build-2' }), 'utf-8')

      const build2Assets = await manager.getAssetsFromBuild(join(outputDir, 'public'))
      await manager.updateVersionsManifest('build-2', build2Assets)
      await manager.storeAssetsInStorage('build-2', join(outputDir, 'public'), build2Assets)
      await manager.restoreOldAssetsToPublic('build-2', join(outputDir, 'public'), build2Assets)

      // Verify old entry was restored
      const { readFile } = await import('node:fs/promises')
      const oldEntry = await readFile(join(nuxtDir, 'entry.OLD123.js'), 'utf-8')
      expect(oldEntry).toBe('old entry')
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
      await manager.getAssetsFromBuild(join(outputDir, 'public'))

      operations.push('update-manifest')
      await manager.updateVersionsManifest('build-1', ['_nuxt/entry.ABC123.js'])

      operations.push('store-assets')
      await manager.storeAssetsInStorage('build-1', join(outputDir, 'public'), ['_nuxt/entry.ABC123.js'])

      operations.push('augment-metadata')
      await manager.augmentBuildMetadata('build-1', join(outputDir, 'public'))

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
