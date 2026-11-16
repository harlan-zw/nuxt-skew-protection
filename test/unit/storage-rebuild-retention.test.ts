import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { createStorage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAssetManager } from '../../src/utils/version-manager'

describe('republishing a build ID', () => {
  let directory: string
  const asset = '_nuxt/entry.hash.js'
  const bytes = Buffer.from('original asset bytes')
  const canonicalKey = `blobs/${createHash('sha256').update(bytes).digest('hex')}`

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'skew-republish-'))
    await mkdir(join(directory, '_nuxt/builds/meta'), { recursive: true })
    await writeFile(join(directory, asset), bytes)
    await writeFile(join(directory, '_nuxt/builds/latest.json'), JSON.stringify({ id: 'same-build' }))
    await writeFile(join(directory, '_nuxt/builds/meta/same-build.json'), JSON.stringify({ id: 'same-build' }))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  async function publishReplacement() {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    await storage.setItemRaw(canonicalKey, bytes)
    await storage.setItem('pending-uploads.json', {
      _tag: 'PendingUploads',
      keys: [canonicalKey],
      uncertainKeys: [canonicalKey],
    })
    const manager = createAssetManager({ driver })
    await manager.publishBuild('same-build', directory, [asset])
    const key = (await manager.getManifest()).versions['same-build']!.storageKeys![asset]!
    expect(key).not.toBe(canonicalKey)
    return { driver, storage, manager, key }
  }

  it('reuses confirmed replacement objects when identical bytes are republished', async () => {
    const { storage, manager, key } = await publishReplacement()
    await manager.publishBuild('same-build', directory, [asset])
    expect((await manager.getManifest()).versions['same-build']!.storageKeys![asset]).toBe(key)
    expect(await storage.getItemRaw(key)).toEqual(bytes)
    await manager.dispose()
  })

  it('removes displaced replacement objects after publishing changed bytes', async () => {
    const { storage, manager, key } = await publishReplacement()
    await writeFile(join(directory, asset), 'changed asset bytes')
    await manager.publishBuild('same-build', directory, [asset])
    const newKey = (await manager.getManifest()).versions['same-build']!.storageKeys![asset]!
    expect(await storage.getItemRaw(newKey)).toEqual(Buffer.from('changed asset bytes'))
    expect(await storage.getItemRaw(key)).toBeNull()
    expect(await storage.getItemRaw(canonicalKey)).toEqual(bytes)
    await manager.dispose()
  })

  it('cleans assets removed from the same build ID', async () => {
    const { storage, manager } = await publishReplacement()
    const removed = '_nuxt/removed.js'
    await writeFile(join(directory, removed), 'removed bytes')
    await manager.publishBuild('same-build', directory, [asset, removed])
    const key = (await manager.getManifest()).versions['same-build']!.storageKeys![removed]!
    await manager.publishBuild('same-build', directory, [asset])
    expect(await storage.getItemRaw(key)).toBeNull()
    await manager.dispose()
  })

  it('cleans displaced objects when republishing metadata only', async () => {
    const { driver, storage, manager, key } = await publishReplacement()
    const metadata = createAssetManager({ driver, persistAssets: false })
    await metadata.publishBuild('same-build', directory, [asset])
    expect((await metadata.getManifest()).versions['same-build']!.assets).toEqual([])
    expect(await storage.getItemRaw(key)).toBeNull()
    expect(await storage.getItemRaw(canonicalKey)).toEqual(bytes)
    await manager.dispose()
  })

  it('cleans displaced legacy objects for the same build ID', async () => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const key = `same-build/${asset}`
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
    const manager = createAssetManager({ driver })
    await manager.publishBuild('same-build', directory, [asset])
    const currentKey = (await manager.getManifest()).versions['same-build']!.storageKeys![asset]!
    expect(await storage.getItemRaw(currentKey)).toEqual(bytes)
    expect(await storage.getItemRaw(key)).toBeNull()
    await manager.dispose()
  })

  it.each(['BeforeCommit', 'AfterCommit'] as const)('preserves previous bytes when a replacement fails: %s', async (failure) => {
    const { driver, storage, manager, key } = await publishReplacement()
    const save = driver.setItem!
    let fail = true
    driver.setItem = async (path, value, options) => {
      if (path !== 'version-manifest.json' || !fail)
        return save(path, value, options)
      if (failure === 'AfterCommit')
        await save(path, value, options)
      throw new Error('Manifest response lost')
    }
    await writeFile(join(directory, asset), 'changed asset bytes')
    await expect(manager.publishBuild('same-build', directory, [asset])).rejects.toThrow('Manifest response lost')
    expect(await storage.getItemRaw(key)).toEqual(bytes)
    const manifest = await manager.getManifest()
    const publishedKey = manifest.versions['same-build']!.storageKeys![asset]!
    expect(await storage.getItemRaw(publishedKey)).toEqual(failure === 'BeforeCommit'
      ? bytes
      : Buffer.from('changed asset bytes'))

    fail = false
    const retry = createAssetManager({ driver })
    await retry.publishBuild('same-build', directory, [asset])
    const retriedKey = (await retry.getManifest()).versions['same-build']!.storageKeys![asset]!
    expect(await storage.getItemRaw(retriedKey)).toEqual(Buffer.from('changed asset bytes'))
    expect(await storage.getItemRaw(key)).toBeNull()
    await retry.dispose()
  })
})

describe('storage response errors', () => {
  it.each(['read', 'write'] as const)('keeps the HTTP status when the %s URL contains 401', async (operation) => {
    const driver = memoryDriver()
    const error = new Error('[unstorage] [s3] http://127.0.0.1:40123/assets/version-manifest.json: 500 Internal Server Error')
    if (operation === 'read') {
      driver.getItem = () => {
        throw error
      }
    }
    else {
      const save = driver.setItem!
      driver.setItem = (key, value, options) => {
        if (key === 'version-manifest.json')
          throw error
        return save(key, value, options)
      }
    }
    const manager = createAssetManager({ driver })
    await expect(operation === 'read'
      ? manager.getManifest()
      : manager.updateVersionsManifest('next', [])).rejects.toThrow('500')
    await manager.dispose()
  })

  it.each([
    '401 Unauthorized',
    'HTTP 401 Unauthorized',
    '[unstorage] [s3] http://127.0.0.1:50001/assets/version-manifest.json: 401 Forbidden',
    'Unauthorized',
    'WRONGPASS invalid credentials',
  ])('recognizes authentication errors: %s', async (message) => {
    const driver = memoryDriver()
    driver.getItem = () => {
      throw new Error(message)
    }
    const manager = createAssetManager({ driver })
    await expect(manager.getManifest()).rejects.toThrow('Authentication failed')
    await manager.dispose()
  })
})
