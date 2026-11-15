import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { createStorage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAssetManager } from '../../src/utils/version-manager'

describe('asset publication', () => {
  let directory: string
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'skew-publication-'))
    await mkdir(join(directory, '_nuxt', 'builds', 'meta'), { recursive: true })
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
    vi.useRealTimers()
  })

  async function build(id: string, chunk = 'shared') {
    await writeFile(join(directory, '_nuxt', 'builds', 'latest.json'), JSON.stringify({ id }))
    await writeFile(join(directory, '_nuxt', 'builds', 'meta', `${id}.json`), JSON.stringify({ id }))
    await writeFile(join(directory, '_nuxt', 'shared.hash.js'), chunk)
    return ['_nuxt/builds/latest.json', `_nuxt/builds/meta/${id}.json`, '_nuxt/shared.hash.js']
  }

  it.each(['upload', 'manifest'])('keeps the live release restorable after a failed %s', async (failure) => {
    const driver = memoryDriver()
    const manager = createAssetManager({ driver })
    await manager.publishBuild('live', directory, await build('live'))
    const original = await manager.getManifest()
    const write = failure === 'upload' ? 'setItemRaw' : 'setItem'
    const implementation = driver[write]!
    driver[write] = vi.fn(() => {
      throw new Error('storage unavailable')
    })
    await expect(manager.publishBuild('failed', directory, await build('failed', 'changed'))).rejects.toThrow('storage unavailable')
    expect(await manager.getManifest()).toEqual(original)
    driver[write] = implementation
    await rm(join(directory, '_nuxt', 'shared.hash.js'))
    await manager.restoreOldAssetsToPublic('next', directory)
    expect(await readFile(join(directory, '_nuxt', 'shared.hash.js'), 'utf8')).toBe('shared')
    await manager.publishBuild('retry', directory, await build('retry'))
    expect((await manager.getManifest()).current).toBe('retry')
  })

  it('does not upload unchanged bytes again', async () => {
    const driver = memoryDriver()
    const upload = vi.spyOn(driver, 'setItemRaw')
    const manager = createAssetManager({ driver })
    await manager.publishBuild('v1', directory, await build('v1'))
    expect(upload.mock.calls.filter(([, value]) => Buffer.from(value).toString() === 'shared')).toHaveLength(1)
    upload.mockClear()
    await manager.publishBuild('v2', directory, await build('v2'))
    expect(upload.mock.calls.some(([, value]) => Buffer.from(value).toString() === 'shared')).toBe(false)
    await rm(join(directory, '_nuxt', 'shared.hash.js'))
    await manager.restoreOldAssetsToPublic('next', directory)
    expect(await readFile(join(directory, '_nuxt', 'shared.hash.js'), 'utf8')).toBe('shared')
  })

  it('keeps legacy deployed objects after a partially uploaded build fails', async () => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const asset = '_nuxt/shared.hash.js'
    const manifest = {
      current: 'legacy',
      versions: { legacy: { timestamp: new Date().toISOString(), assets: [asset] } },
      fileIdToVersion: { 'shared.hash.js': 'legacy' },
    }
    await storage.setItem('version-manifest.json', manifest)
    await storage.setItemRaw(`legacy/${asset}`, Buffer.from('shared'))
    const upload = driver.setItemRaw!
    driver.setItemRaw = vi.fn(async (key, value, options) => {
      if (Buffer.from(value).toString() === 'fail')
        throw new Error('PUT failed')
      return upload(key, value, options)
    })
    const manager = createAssetManager({ driver })
    const assets = await build('new')
    // Put the failing object in a later batch, after shared objects finish uploading.
    for (let i = 0; i < 26; i++) {
      const path = `_nuxt/asset-${i}.js`
      await writeFile(join(directory, path), i === 25 ? 'fail' : `content ${i}`)
      assets.push(path)
    }
    await expect(manager.publishBuild('new', directory, assets)).rejects.toThrow('PUT failed')
    expect(await storage.getItem('version-manifest.json')).toEqual(manifest)
    expect(await storage.getItemRaw(`legacy/${asset}`)).toEqual(Buffer.from('shared'))
  })

  it('stores augmented metadata and preserves shared bytes during retention cleanup', async () => {
    const driver = memoryDriver()
    const manager = createAssetManager({ driver, maxNumberOfVersions: 1 })
    await manager.publishBuild('v1', directory, await build('v1'))
    const assets = await build('v2')
    await writeFile(join(directory, '_nuxt', 'renamed.hash.js'), 'shared')
    await manager.publishBuild('v2', directory, [...assets, '_nuxt/renamed.hash.js'])
    expect(Object.keys((await manager.getManifest()).versions)).toEqual(['v2'])
    await manager.cleanupExpiredVersions()
    await rm(join(directory, '_nuxt'), { recursive: true })
    await manager.restoreOldAssetsToPublic('next', directory)
    expect(await readFile(join(directory, '_nuxt', 'renamed.hash.js'), 'utf8')).toBe('shared')
    const meta = JSON.parse(await readFile(join(directory, '_nuxt', 'builds', 'meta', 'v2.json'), 'utf8'))
    expect(meta.skewProtection.timestamp).toBe((await manager.getManifest()).versions.v2!.timestamp)
    const skew = JSON.parse(await readFile(join(directory, '_nuxt', 'builds', 'skew', 'v2.json'), 'utf8'))
    expect(skew).toEqual({ deletedChunks: {} })
  })

  it('does not delete expired objects when the cleanup manifest cannot be saved', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01'))
    const driver = memoryDriver()
    const manager = createAssetManager({ driver, retentionDays: 7 })
    await manager.publishBuild('v1', directory, await build('v1'))
    await manager.publishBuild('v2', directory, await build('v2'))
    const original = await manager.getManifest()
    vi.setSystemTime(new Date('2026-01-16'))
    driver.setItem = vi.fn(() => {
      throw new Error('manifest unavailable')
    })
    await expect(manager.cleanupExpiredVersions()).rejects.toThrow('manifest unavailable')
    expect(await manager.getManifest()).toEqual(original)
    await rm(join(directory, '_nuxt'), { recursive: true })
    await manager.restoreOldAssetsToPublic('next', directory)
    expect(JSON.parse(await readFile(join(directory, '_nuxt', 'builds', 'meta', 'v1.json'), 'utf8')).id).toBe('v1')
  })

  it('prunes expired history before restore while retaining the live release', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01'))
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const manager = createAssetManager({ driver, retentionDays: 7 })
    await manager.publishBuild('v0', directory, await build('v0'))
    vi.setSystemTime(new Date('2026-01-07'))
    await manager.publishBuild('live', directory, await build('live'))
    const manifest = await manager.getManifest()
    const liveKeys = new Set(Object.values(manifest.versions.live!.storageKeys!))
    for (const asset of manifest.versions.v0!.assets) {
      const key = manifest.versions.v0!.storageKeys![asset]!
      if (!liveKeys.has(key))
        await storage.removeItem(key)
    }
    vi.setSystemTime(new Date('2026-01-16'))
    await manager.publishBuild('next', directory, await build('next'))
    const result = await manager.getManifest()
    expect(result.versions.v0).toBeUndefined()
    expect(result.versions.live).toBeDefined()
  })

  it.each(['../escape.js', '/absolute.js', '_nuxt/../../escape.js', '..\\escape.js'])('rejects unsafe manifest path %s', async (asset) => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    await storage.setItem('version-manifest.json', {
      current: 'old',
      versions: { old: { timestamp: new Date().toISOString(), assets: [asset] } },
    })
    await storage.setItemRaw(`old/${asset}`, Buffer.from('unsafe'))
    const manager = createAssetManager({ driver })
    await expect(manager.restoreOldAssetsToPublic('next', directory)).rejects.toThrow('Invalid asset path')
  })
})
