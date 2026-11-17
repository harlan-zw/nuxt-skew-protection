import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { createStorage } from 'unstorage'
import fsDriver from 'unstorage/drivers/fs'
import fsLiteDriver from 'unstorage/drivers/fs-lite'
import memoryDriver from 'unstorage/drivers/memory'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAssetManager } from '../../src/utils/version-manager'

describe('legacy asset recovery', () => {
  let directory: string
  const asset = '_nuxt/entry.hash.js'
  const key = `same-build/${asset}`
  const bytes = Buffer.from('legacy bytes')

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'skew-legacy-recovery-'))
    await mkdir(join(directory, '_nuxt/builds/meta'), { recursive: true })
    await writeFile(join(directory, asset), 'replacement bytes')
    await writeFile(join(directory, '_nuxt/builds/latest.json'), JSON.stringify({ id: 'same-build' }))
    await writeFile(join(directory, '_nuxt/builds/meta/same-build.json'), JSON.stringify({ id: 'same-build' }))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it.each([
    {
      name: 'memory',
      driver: () => memoryDriver(),
    },
    {
      name: 'fs',
      driver: () => fsDriver({
        base: join(directory, 'storage'),
      }),
    },
    {
      name: 'fs-lite',
      driver: () => fsLiteDriver({
        base: join(directory, 'storage'),
      }),
    },
  ])('recovers displaced legacy bytes after a lost manifest response: $name', async ({ driver: createDriver }) => {
    const driver = createDriver()
    const storage = createStorage({ driver })
    await storage.setItemRaw(key, bytes)
    await storage.setItem('version-manifest.json', {
      current: 'same-build',
      versions: {
        'same-build': {
          timestamp: new Date().toISOString(),
          assets: [asset],
        },
      },
    })
    const save = driver.setItem!
    driver.setItem = async (path, value, options) => {
      await save(path, value, options)
      if (path === 'version-manifest.json')
        throw new Error('Manifest response lost')
    }
    const publisher = createAssetManager({ driver })
    await expect(publisher.publishBuild('same-build', directory, [asset])).rejects.toThrow('Manifest response lost')
    expect(await storage.getItemRaw(key)).toEqual(bytes)

    driver.setItem = save
    const retry = createAssetManager({ driver })
    await retry.cleanupExpiredVersions()
    const currentKey = (await retry.getManifest()).versions['same-build']!.storageKeys![asset]!
    expect(await storage.getItemRaw(currentKey)).toEqual(Buffer.from('replacement bytes'))
    expect(await storage.getItemRaw(key)).toBeNull()
    await retry.publishBuild('same-build', directory, [asset])
    expect(await storage.getItemRaw((await retry.getManifest()).versions['same-build']!.storageKeys![asset]!)).toEqual(Buffer.from('replacement bytes'))
    await retry.dispose()
  })

  it.each([
    'Referenced',
    'UncertainWrite',
    'UncertainDelete',
    'UnknownOutcome',
    'EventualReads',
  ] as const)('preserves legacy bytes with unsafe recovery: %s', async (protection) => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    await storage.setItemRaw(key, bytes)
    await storage.setItem('version-manifest.json', {
      current: 'same-build',
      versions: {
        'same-build': {
          timestamp: new Date().toISOString(),
          assets: protection === 'Referenced'
            ? [asset]
            : [],
        },
      },
    })
    await storage.setItem('pending-uploads.json', {
      _tag: 'PendingUploads',
      keys: [key],
      ...(protection === 'UnknownOutcome'
        ? {}
        : {
            uncertainKeys: protection === 'UncertainWrite'
              ? [key]
              : [],
          }),
    })
    if (protection === 'UncertainDelete')
      await storage.setItem(`asset-operations/${createHash('sha256').update(key).digest('hex')}`, 'unresolved-delete')
    const manager = createAssetManager({
      driver,
      readConsistency: protection === 'EventualReads'
        ? 'eventual'
        : 'strong',
    })
    await manager.cleanupExpiredVersions()
    expect(await storage.getItemRaw(key)).toEqual(bytes)
    await manager.dispose()
  })

  it.each([
    'same-build/../version-manifest.json',
    'same-build/./entry.js',
    'same-build//entry.js',
    '/same-build/_nuxt/entry.js',
    'same-build/_nuxt/entry.js/',
    'same-build:_nuxt:entry.js',
    'same-build/_nuxt\\entry.js',
    'same-build/_nuxt/%2e%2e/version-manifest.json',
    'same-build/_nuxt/entry.js?query',
    'same-build/_nuxt/entry.js#hash',
    'same-build/_nuxt/entry.js\n',
    'same-build/_nuxt/entry\u0000.js',
    'asset-operations/key',
    'asset-operation-completions/key',
    'blobs/invalid-hash',
    'pending-uploads.json/key',
    'version-manifest.json/key',
  ])('rejects unsafe recovery keys before deleting bytes: %s', async (invalidKey) => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const manifest = { current: 'live', versions: {} }
    await storage.setItem('version-manifest.json', manifest)
    await storage.setItemRaw('safe/_nuxt/kept.js', bytes)
    await storage.setItem('pending-uploads.json', {
      _tag: 'PendingUploads',
      keys: ['safe/_nuxt/kept.js', invalidKey],
      uncertainKeys: [],
    })
    const manager = createAssetManager({ driver })
    await expect(manager.cleanupExpiredVersions()).rejects.toThrow('Invalid pending asset uploads')
    expect(await storage.getItem('version-manifest.json')).toEqual(manifest)
    expect(await storage.getItemRaw('safe/_nuxt/kept.js')).toEqual(bytes)
    await manager.dispose()
  })
})
