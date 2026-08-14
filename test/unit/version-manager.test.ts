import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveBuildTimeDriver } from '../../src/unstorage/utils'
import { createAssetManager } from '../../src/utils/version-manager'

describe('asset manager', () => {
  const testDir = join(import.meta.dirname, '.tmp', 'version-manager')
  const storageDir = join(testDir, 'storage')
  const publicDir = join(testDir, 'public')

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true })
    await mkdir(storageDir, { recursive: true })
    await mkdir(join(publicDir, '_nuxt'), { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  async function createManager(options: { retentionDays?: number, maxNumberOfVersions?: number } = {}) {
    return createAssetManager({
      ...options,
      driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }),
    })
  }

  it('collects nested assets from the configured build directory', async () => {
    const manager = await createManager()
    await mkdir(join(publicDir, '_nuxt', 'components'), { recursive: true })
    await writeFile(join(publicDir, '_nuxt', 'entry.js'), 'entry')
    await writeFile(join(publicDir, '_nuxt', 'components', 'button.js'), 'button')

    await expect(manager.getAssetsFromBuild(publicDir)).resolves.toEqual([
      '_nuxt/components/button.js',
      '_nuxt/entry.js',
    ])
  })

  it('fails when the build directory has no assets', async () => {
    const manager = await createManager()
    await expect(manager.getAssetsFromBuild(publicDir)).rejects.toThrow('No build assets found')
  })

  it('fails when a declared asset cannot be read', async () => {
    const manager = await createManager()
    await expect(manager.storeVersion('v1', publicDir, ['_nuxt/missing.js'])).rejects.toThrow('missing.js')
  })

  it('preserves path identity when basenames match', async () => {
    const manager = await createManager()
    await mkdir(join(publicDir, '_nuxt', 'old'), { recursive: true })
    await writeFile(join(publicDir, '_nuxt', 'old', 'chunk.js'), 'old chunk')
    await manager.storeVersion('v1', publicDir, ['_nuxt/old/chunk.js'])

    await rm(join(publicDir, '_nuxt', 'old'), { recursive: true })
    await mkdir(join(publicDir, '_nuxt', 'new'), { recursive: true })
    await writeFile(join(publicDir, '_nuxt', 'new', 'chunk.js'), 'new chunk')
    await manager.storeVersion('v2', publicDir, ['_nuxt/new/chunk.js'])
    await manager.restoreOldAssetsToPublic('v2', publicDir, ['_nuxt/new/chunk.js'])

    await expect(readFile(join(publicDir, '_nuxt', 'old', 'chunk.js'), 'utf8')).resolves.toBe('old chunk')
  })

  it('rejects content changes at an immutable URL', async () => {
    const manager = await createManager()
    const asset = '_nuxt/chunk.js'
    await writeFile(join(publicDir, asset), 'first')
    await manager.storeVersion('v1', publicDir, [asset])
    await writeFile(join(publicDir, asset), 'second')

    await expect(manager.storeVersion('v2', publicDir, [asset])).rejects.toThrow('changed without changing its URL')
  })

  it('keeps one release when concurrent builds publish divergent bytes at one URL', async () => {
    const firstPublicDir = join(testDir, 'first-public')
    const secondPublicDir = join(testDir, 'second-public')
    const asset = '_nuxt/chunk.js'
    await mkdir(join(firstPublicDir, '_nuxt'), { recursive: true })
    await mkdir(join(secondPublicDir, '_nuxt'), { recursive: true })
    await writeFile(join(firstPublicDir, asset), 'first')
    await writeFile(join(secondPublicDir, asset), 'second')

    let recordReads = 0
    let releaseRecordReads!: () => void
    const recordReadBarrier = new Promise<void>(resolve => releaseRecordReads = resolve)
    const values = new Map<string, unknown>()
    const storage = {
      async getKeys(prefix = '') {
        if (prefix === 'version-records' && ++recordReads <= 2) {
          if (recordReads === 2)
            releaseRecordReads()
          await recordReadBarrier
        }
        return [...values.keys()].filter(key => key.startsWith(prefix))
      },
      getItem: async (key: string) => values.get(key) ?? null,
      getItemRaw: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: unknown) => void values.set(key, value),
      setItemRaw: async (key: string, value: unknown) => void values.set(key, value),
      removeItem: async (key: string) => void values.delete(key),
    }
    const firstManager = createAssetManager({ storage: storage as any })
    const secondManager = createAssetManager({ storage: storage as any })

    const results = await Promise.allSettled([
      firstManager.storeVersion('v1', firstPublicDir, [asset]),
      secondManager.storeVersion('v2', secondPublicDir, [asset]),
    ])

    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    await expect(firstManager.getManifest()).resolves.toMatchObject({
      versions: { v1: { assets: [asset] } },
    })
  })

  it('stores isolated release records and applies count retention', async () => {
    const manager = await createManager({ maxNumberOfVersions: 2 })
    for (let index = 1; index <= 3; index++) {
      const asset = `_nuxt/v${index}.js`
      await writeFile(join(publicDir, asset), `v${index}`)
      await manager.storeVersion(`v${index}`, publicDir, [asset])
      await new Promise(resolve => setTimeout(resolve, 2))
    }

    await manager.cleanupExpiredVersions('v3')
    const manifest = await manager.getManifest('v3')
    expect(manifest.current).toBe('v3')
    expect(Object.keys(manifest.versions).sort()).toEqual(['v2', 'v3'])
  })

  it('tracks release metadata without retaining asset bytes', async () => {
    const manager = await createManager()
    const asset = '_nuxt/entry.js'
    await writeFile(join(publicDir, asset), 'entry')

    await manager.storeVersion('v1', publicDir, [asset], { bundleAssets: false })
    await rm(join(publicDir, asset))
    await manager.restoreOldAssetsToPublic('v2', publicDir)

    await expect(readFile(join(publicDir, asset), 'utf8')).rejects.toThrow()
    await expect(manager.getManifest('v1')).resolves.toMatchObject({
      current: 'v1',
      versions: { v1: { assets: [asset] } },
    })
  })

  it('adds retained releases to Nuxt build metadata', async () => {
    const manager = await createManager()
    const buildsDir = join(publicDir, '_nuxt', 'builds')
    await mkdir(join(buildsDir, 'meta'), { recursive: true })
    await writeFile(join(publicDir, '_nuxt', 'entry.js'), 'entry')
    await writeFile(join(buildsDir, 'latest.json'), JSON.stringify({ id: 'v1' }))
    await writeFile(join(buildsDir, 'meta', 'v1.json'), JSON.stringify({ id: 'v1' }))
    await manager.storeVersion('v1', publicDir, ['_nuxt/entry.js'])

    await manager.augmentBuildMetadata('v1', publicDir)

    const latest = JSON.parse(await readFile(join(buildsDir, 'latest.json'), 'utf8'))
    const meta = JSON.parse(await readFile(join(buildsDir, 'meta', 'v1.json'), 'utf8'))
    expect(latest.skewProtection.versions.v1.timestamp).toBeTypeOf('string')
    expect(meta.skewProtection.expires).toBeTypeOf('string')
  })

  it('fails metadata augmentation when Nuxt manifests are absent', async () => {
    const manager = await createManager()
    await writeFile(join(publicDir, '_nuxt', 'entry.js'), 'entry')
    await manager.storeVersion('v1', publicDir, ['_nuxt/entry.js'])
    await expect(manager.augmentBuildMetadata('v1', publicDir)).rejects.toThrow('app manifest is missing')
  })
})
