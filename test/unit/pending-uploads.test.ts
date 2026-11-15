import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { createStorage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAssetManager } from '../../src/utils/version-manager'

describe('abandoned asset uploads', () => {
  let directory: string
  const asset = '_nuxt/entry.hash.js'
  const key = `blobs/${createHash('sha256').update('new bytes').digest('hex')}`

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'skew-pending-'))
    await mkdir(join(directory, '_nuxt', 'builds', 'meta'), { recursive: true })
    await writeFile(join(directory, asset), 'new bytes')
    await writeFile(join(directory, '_nuxt', 'builds', 'latest.json'), JSON.stringify({ id: 'next' }))
    await writeFile(join(directory, '_nuxt', 'builds', 'meta', 'next.json'), JSON.stringify({ id: 'next' }))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('keeps every committed object when the first read after publication is stale', async () => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const previous = JSON.stringify({ current: '', versions: {} })
    await storage.setItem('version-manifest.json', JSON.parse(previous))
    const save = driver.setItem!
    const read = driver.getItem!
    let stale = false
    driver.setItem = async (item, value, options) => {
      await save(item, value, options)
      if (item === 'version-manifest.json')
        stale = true
    }
    driver.getItem = (item, options) => {
      if (item === 'version-manifest.json' && stale) {
        stale = false
        return previous
      }
      return read(item, options)
    }

    await createAssetManager({ driver }).publishBuild('next', directory, [asset])
    driver.getItem = read
    const manifest = await createAssetManager({ driver }).getManifest()
    for (const version of Object.values(manifest.versions)) {
      for (const objectKey of Object.values(version.storageKeys!))
        expect(await storage.getItemRaw(objectKey)).not.toBeNull()
    }
    expect(await storage.getItemRaw(key)).toEqual(Buffer.from('new bytes'))
  })

  it.each([
    null,
    { current: '', versions: {} },
  ])('preserves uncertain committed bytes and records after a lost response and stale read: %j', async (staleManifest) => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const save = driver.setItem!
    driver.setItem = async (item, value, options) => {
      await save(item, value, options)
      if (item === 'version-manifest.json')
        throw new Error('response lost')
    }
    await expect(createAssetManager({ driver }).publishBuild('next', directory, [asset])).rejects.toThrow('response lost')
    driver.setItem = save
    const pending = await storage.getItem('pending-uploads.json')
    const read = driver.getItem!
    driver.getItem = (item, options) => item === 'version-manifest.json'
      ? staleManifest === null
        ? null
        : JSON.stringify(staleManifest)
      : read(item, options)

    await createAssetManager({ driver }).cleanupExpiredVersions()
    expect(await storage.getItemRaw(key)).toEqual(Buffer.from('new bytes'))
    expect(await storage.getItem('pending-uploads.json')).toEqual(pending)
  })

  it.each([
    { current: 'live' },
    { current: 'live', versions: [] },
    {
      current: 'live',
      versions: {
        live: { assets: 'invalid' },
      },
    },
    {
      current: 'live',
      versions: {
        live: {
          assets: [42],
        },
      },
    },
    {
      current: 'live',
      versions: {
        live: {
          assets: [asset],
          storageKeys: { [asset]: 42 },
        },
      },
    },
  ])('rejects malformed manifest references without deleting bytes or records: %j', async (manifest) => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const pending = {
      _tag: 'PendingUploads',
      keys: [key],
    }
    await storage.setItemRaw(key, Buffer.from('new bytes'))
    await storage.setItem('pending-uploads.json', pending)
    await storage.setItem('version-manifest.json', manifest)

    await expect(createAssetManager({ driver }).cleanupExpiredVersions()).rejects.toThrow('Invalid version manifest')
    expect(await storage.getItemRaw(key)).toEqual(Buffer.from('new bytes'))
    expect(await storage.getItem('pending-uploads.json')).toEqual(pending)
  })

  it('stops before uploading bytes when the pending record cannot be saved', async () => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const save = driver.setItem!
    driver.setItem = (item, value, options) => {
      if (item === 'pending-uploads.json')
        throw new Error('pending record unavailable')
      return save(item, value, options)
    }

    await expect(createAssetManager({ driver }).publishBuild('next', directory, [asset])).rejects.toThrow('pending record unavailable')
    expect(await storage.getItemRaw(key)).toBeNull()
    expect((await createAssetManager({ driver }).getManifest()).current).toBe('')
  })

  it('keeps committed bytes when the manifest write succeeds before its response fails', async () => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const save = driver.setItem!
    driver.setItem = async (item, value, options) => {
      await save(item, value, options)
      if (item === 'version-manifest.json')
        throw new Error('response lost')
    }
    await expect(createAssetManager({ driver }).publishBuild('next', directory, [asset])).rejects.toThrow('response lost')
    driver.setItem = save

    await createAssetManager({ driver }).cleanupExpiredVersions()
    expect(await storage.getItemRaw(key)).toEqual(Buffer.from('new bytes'))
    expect((await createAssetManager({ driver }).getManifest()).current).toBe('next')
  })

  it('defers failed superseded deletion when a later read cannot prove current references', async () => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const manager = createAssetManager({ driver, maxNumberOfVersions: 1 })
    await manager.publishBuild('next', directory, [asset])
    await writeFile(join(directory, asset), 'newer bytes')
    await writeFile(join(directory, '_nuxt', 'builds', 'latest.json'), JSON.stringify({ id: 'second' }))
    await writeFile(join(directory, '_nuxt', 'builds', 'meta', 'second.json'), JSON.stringify({ id: 'second' }))
    const remove = driver.removeItem!
    driver.removeItem = (item, options) => {
      if (item === key.replaceAll('/', ':'))
        throw new Error('DELETE unavailable')
      return remove(item, options)
    }
    await manager.publishBuild('second', directory, [asset])
    expect((await manager.getManifest()).current).toBe('second')
    expect(await storage.getItemRaw(key)).toEqual(Buffer.from('new bytes'))
    driver.removeItem = remove

    await createAssetManager({ driver }).cleanupExpiredVersions()
    expect(await storage.getItemRaw(key)).toEqual(Buffer.from('new bytes'))
    expect(await storage.getItem('pending-uploads.json')).toEqual({
      _tag: 'PendingUploads',
      keys: [key],
    })
    const currentKey = (await manager.getManifest()).versions.second!.storageKeys![asset]!
    expect(await storage.getItemRaw(currentKey)).toEqual(Buffer.from('newer bytes'))
  })

  it('allows the next publication when storage cannot delete objects', async () => {
    const driver = memoryDriver()
    driver.removeItem = () => {
      throw new Error('DELETE forbidden')
    }
    const manager = createAssetManager({ driver })
    await manager.publishBuild('next', directory, [asset])
    await writeFile(join(directory, '_nuxt', 'builds', 'latest.json'), JSON.stringify({ id: 'second' }))
    await writeFile(join(directory, '_nuxt', 'builds', 'meta', 'second.json'), JSON.stringify({ id: 'second' }))

    await manager.publishBuild('second', directory, [asset])
    expect((await manager.getManifest()).current).toBe('second')
    const storage = createStorage({ driver })
    expect(await storage.getItemRaw(key)).toEqual(Buffer.from('new bytes'))
  })

  it.each(['version-manifest.json', 'blobs/../version-manifest.json'])('rejects a pending deletion outside shared objects: %s', async (invalidKey) => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const manifest = { current: 'live', versions: {} }
    await storage.setItem('version-manifest.json', manifest)
    await storage.setItem('pending-uploads.json', {
      _tag: 'PendingUploads',
      keys: [invalidKey],
    })

    await expect(createAssetManager({ driver }).cleanupExpiredVersions()).rejects.toThrow('Invalid pending asset uploads')
    expect(await storage.getItem('version-manifest.json')).toEqual(manifest)
  })
})
