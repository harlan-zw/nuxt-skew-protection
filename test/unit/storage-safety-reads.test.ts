import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { setImmediate } from 'node:timers/promises'
import { join } from 'pathe'
import { createStorage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAssetManager } from '../../src/utils/version-manager'

function objectKey(bytes: string) {
  return `blobs/${createHash('sha256').update(bytes).digest('hex')}`
}

function operationKey(key: string) {
  return `asset-operations/${createHash('sha256').update(key).digest('hex')}`
}

describe('storage safety reads', () => {
  let directory: string
  const asset = '_nuxt/new.hash.js'

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'skew-safety-reads-'))
    await mkdir(join(directory, '_nuxt/builds/meta'), { recursive: true })
    await writeFile(join(directory, asset), 'new bytes')
    await writeFile(join(directory, '_nuxt/builds/latest.json'), JSON.stringify({ id: 'next' }))
    await writeFile(join(directory, '_nuxt/builds/meta/next.json'), JSON.stringify({ id: 'next' }))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('checks retained objects once with bounded concurrency before uploading', async () => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const retained = Array.from({ length: 120 }, (_, index) => ({
      asset: `_nuxt/retained-${index}.js`,
      bytes: `retained bytes ${index}`,
      key: objectKey(`retained bytes ${index}`),
    }))
    await Promise.all(retained.flatMap(item => [
      storage.setItemRaw(item.key, Buffer.from(item.bytes)),
      storage.setItem(operationKey(item.key), 'completed-publication'),
    ]))
    await storage.setItem('asset-operation-completions/completed-publication', true)
    const version = {
      timestamp: new Date().toISOString(),
      assets: retained.map(item => item.asset),
      storageKeys: Object.fromEntries(retained.map(item => [item.asset, item.key])),
    }
    await storage.setItem('version-manifest.json', {
      current: 'next',
      versions: {
        first: version,
        second: version,
        third: version,
        next: {
          timestamp: version.timestamp,
          assets: [asset],
        },
      },
    })

    const read = driver.getItem!
    const save = driver.setItemRaw!
    const reads = new Map<string, number>()
    let beforeUpload = true
    let active = 0
    let peak = 0
    let completionReads = 0
    driver.getItem = async (key, options) => {
      if (!beforeUpload)
        return read(key, options)
      if (key.startsWith('asset-operation-completions:'))
        completionReads++
      if (!key.startsWith('asset-operations:'))
        return read(key, options)
      reads.set(key, (reads.get(key) || 0) + 1)
      active++
      peak = Math.max(peak, active)
      await setImmediate()
      const value = await read(key, options)
      active--
      return value
    }
    driver.setItemRaw = (key, value, options) => {
      beforeUpload = false
      return save(key, value, options)
    }

    const manager = createAssetManager({ driver })
    await manager.storeAssetsInStorage('next', directory, [asset])
    for (const item of retained) {
      expect(reads.get(operationKey(item.key).replaceAll('/', ':'))).toBe(1)
      expect(await storage.getItemRaw(item.key)).toEqual(Buffer.from(item.bytes))
    }
    expect(completionReads).toBe(1)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(50)
    expect((await manager.getManifest()).current).toBe('next')
    await manager.dispose()
  })

  it('waits for in-flight safety reads and preserves the manifest when a read fails', async () => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const keys = ['first', 'second'].map(objectKey)
    const version = {
      timestamp: new Date().toISOString(),
      assets: ['_nuxt/first.js', '_nuxt/second.js'],
      storageKeys: { '_nuxt/first.js': keys[0], '_nuxt/second.js': keys[1] },
    }
    const manifest = {
      current: 'next',
      versions: {
        retained: version,
        next: {
          timestamp: version.timestamp,
          assets: [asset],
        },
      },
    }
    await storage.setItem('version-manifest.json', manifest)
    const read = driver.getItem!
    let active = 0
    driver.getItem = async (key, options) => {
      if (!key.startsWith('asset-operations:'))
        return read(key, options)
      active++
      try {
        await setImmediate()
        if (key === operationKey(keys[1]!).replaceAll('/', ':'))
          throw new Error('safety read unavailable')
        await setImmediate()
        return await read(key, options)
      }
      finally {
        active--
      }
    }
    const manager = createAssetManager({ driver })
    await expect(manager.storeAssetsInStorage('next', directory, [asset])).rejects.toThrow('safety read unavailable')
    expect(active).toBe(0)
    expect(await manager.getManifest()).toEqual(manifest)
    await manager.dispose()
  })

  it('refreshes safety records when the same manager publishes again', async () => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const manager = createAssetManager({ driver, maxNumberOfVersions: 1 })
    const canonicalKey = objectKey('new bytes')
    await manager.publishBuild('next', directory, [asset])

    // A previous request can leave a guard after a delayed journal replacement.
    await storage.setItem(operationKey(canonicalKey), 'unresolved-delete')
    await storage.setItem('pending-uploads.json', { _tag: 'PendingUploads', keys: [], uncertainKeys: [] })
    await writeFile(join(directory, '_nuxt/builds/latest.json'), JSON.stringify({ id: 'second' }))
    await writeFile(join(directory, '_nuxt/builds/meta/second.json'), JSON.stringify({ id: 'second' }))
    await manager.publishBuild('second', directory, [asset])
    const key = (await manager.getManifest()).versions.second!.storageKeys![asset]!
    await storage.removeItem(canonicalKey)

    expect(key).not.toBe(canonicalKey)
    expect(await storage.getItemRaw(key)).toEqual(Buffer.from('new bytes'))
    await manager.dispose()
  })
})
