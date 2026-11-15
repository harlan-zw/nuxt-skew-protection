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

  it.each([
    { name: 'fs', createDriver: fsDriver },

    { name: 'fs-lite', createDriver: fsLiteDriver },
  ])('publishes identical bytes beside an uncertain filesystem object: $name', async ({ createDriver }) => {
    const driver = createDriver({
      base: join(directory, 'storage'),
    })
    const storage = createStorage({ driver })
    await storage.setItemRaw(key, Buffer.from('new bytes'))
    await storage.setItem('pending-uploads.json', {
      _tag: 'PendingUploads',
      keys: [key],
      uncertainKeys: [key],
    })

    const manager = createAssetManager({ driver, maxNumberOfVersions: 1 })
    await manager.publishBuild('next', directory, [asset])
    const replacementKey = (await manager.getManifest()).versions.next!.storageKeys![asset]!
    expect(replacementKey).not.toBe(key)
    expect(await storage.getItemRaw(replacementKey)).toEqual(Buffer.from('new bytes'))
    expect(await storage.getItemRaw(key)).toEqual(Buffer.from('new bytes'))

    await writeFile(join(directory, '_nuxt', 'builds', 'latest.json'), JSON.stringify({ id: 'second' }))
    await writeFile(join(directory, '_nuxt', 'builds', 'meta', 'second.json'), JSON.stringify({ id: 'second' }))
    await manager.publishBuild('second', directory, [asset])
    expect((await manager.getManifest()).versions.second!.storageKeys![asset]).toBe(replacementKey)

    await writeFile(join(directory, asset), 'changed bytes')
    await writeFile(join(directory, '_nuxt', 'builds', 'latest.json'), JSON.stringify({ id: 'third' }))
    await writeFile(join(directory, '_nuxt', 'builds', 'meta', 'third.json'), JSON.stringify({ id: 'third' }))
    await manager.publishBuild('third', directory, [asset])
    expect(await storage.getItemRaw(replacementKey)).toBeNull()
    expect(await storage.getItemRaw(key)).toEqual(Buffer.from('new bytes'))
    await storage.dispose()
  })

  it.each(['strong', 'eventual'] as const)('recovers interrupted asset uploads only with %s reads', async (readConsistency) => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const assets = [asset]
    for (let index = 0; index < 26; index++) {
      const path = `_nuxt/extra-${index}.js`
      await writeFile(join(directory, path), index === 25
        ? 'fail'
        : `extra ${index}`)
      assets.push(path)
    }
    const upload = driver.setItemRaw!
    driver.setItemRaw = (item, value, options) => {
      if (Buffer.from(value).toString() === 'fail')
        throw new Error('upload interrupted')
      return upload(item, value, options)
    }
    await expect(createAssetManager({ driver, readConsistency }).publishBuild('next', directory, assets)).rejects.toThrow('upload interrupted')
    expect(await storage.getItemRaw(key)).toEqual(Buffer.from('new bytes'))

    await createAssetManager({ driver, readConsistency }).cleanupExpiredVersions()
    expect(await storage.getItemRaw(key)).toEqual(readConsistency === 'strong'
      ? null
      : Buffer.from('new bytes'))
  })

  it('preserves an uncertain manifest write even when strong reads report absence', async () => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const save = driver.setItem!
    driver.setItem = async (item, value, options) => {
      await save(item, value, options)
      if (item === 'version-manifest.json')
        throw new Error('response lost')
    }
    await expect(createAssetManager({ driver, readConsistency: 'strong' }).publishBuild('next', directory, [asset])).rejects.toThrow('response lost')
    driver.setItem = save
    const read = driver.getItem!
    driver.getItem = (item, options) => item === 'version-manifest.json'
      ? null
      : read(item, options)

    await createAssetManager({ driver, readConsistency: 'strong' }).cleanupExpiredVersions()
    expect(await storage.getItemRaw(key)).toEqual(Buffer.from('new bytes'))
  })

  it('protects legacy objects referenced by an uncertain manifest write', async () => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const legacyAsset = '_nuxt/legacy.hash.js'
    const legacyKey = `legacy/${legacyAsset}`
    const timestamp = new Date().toISOString()
    const legacy = {
      timestamp,
      expires: timestamp,
      assets: [legacyAsset],
    }
    await storage.setItem('version-manifest.json', {
      current: 'legacy',
      versions: { legacy },
    })
    await storage.setItemRaw(legacyKey, Buffer.from('legacy bytes'))
    const save = driver.setItem!
    driver.setItem = async (item, value, options) => {
      await save(item, value, options)
      if (item === 'version-manifest.json')
        throw new Error('response lost')
    }
    await expect(createAssetManager({ driver, readConsistency: 'strong' }).publishBuild('next', directory, [asset])).rejects.toThrow('response lost')
    driver.setItem = save
    await storage.setItem('version-manifest.json', {
      current: 'replacement',
      versions: {
        legacy: { ...legacy, timestamp: '2020-01-01T00:00:00.000Z' },
        replacement: { timestamp, expires: timestamp, assets: [] },
      },
    })

    await createAssetManager({ driver, readConsistency: 'strong' }).cleanupExpiredVersions()
    expect(await storage.getItemRaw(legacyKey)).toEqual(Buffer.from('legacy bytes'))
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
    const manager = createAssetManager({ driver, maxNumberOfVersions: 1, readConsistency: 'eventual' })
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

    await createAssetManager({ driver, readConsistency: 'eventual' }).cleanupExpiredVersions()
    expect(await storage.getItemRaw(key)).toEqual(Buffer.from('new bytes'))
    expect(await storage.getItem('pending-uploads.json')).toEqual({
      _tag: 'PendingUploads',
      keys: [key],
      uncertainKeys: [],
    })
    const currentKey = (await manager.getManifest()).versions.second!.storageKeys![asset]!
    expect(await storage.getItemRaw(currentKey)).toEqual(Buffer.from('newer bytes'))
  })

  it('does not reuse an object whose failed DELETE may finish later', async () => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    // Seed an abandoned upload without starting a manifest write.
    await storage.setItem('pending-uploads.json', {
      _tag: 'PendingUploads',
      keys: [key],
      uncertainKeys: [],
    })
    await storage.setItemRaw(key, Buffer.from('new bytes'))
    const remove = driver.removeItem!
    let delayedDelete: (() => unknown) | undefined
    driver.removeItem = (item, options) => {
      if (item === key.replaceAll('/', ':') && delayedDelete === undefined) {
        delayedDelete = () => remove(item, options)
        throw new Error('DELETE response lost')
      }
      return remove(item, options)
    }
    await createAssetManager({ driver, readConsistency: 'strong' }).cleanupExpiredVersions()
    const manager = createAssetManager({ driver, readConsistency: 'strong' })
    await manager.publishBuild('next', directory, [asset])
    await delayedDelete!()

    const current = (await manager.getManifest()).versions.next!
    for (const storedKey of Object.values(current.storageKeys!))
      expect(await storage.getItemRaw(storedKey)).not.toBeNull()
  })

  it('preserves current references after a delayed cleanup journal PUT erases a pending DELETE', async () => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const save = driver.setItem!
    const remove = driver.removeItem!
    let delayedJournal: (() => unknown) | undefined
    let delayedDelete: (() => unknown) | undefined
    driver.setItem = (item, value, options) => {
      if (item === 'pending-uploads.json' && delayedJournal === undefined
        && JSON.parse(String(value)).keys.length === 0) {
        delayedJournal = () => save(item, value, options)
        throw new Error('journal PUT response lost')
      }
      return save(item, value, options)
    }
    driver.removeItem = (item, options) => {
      if (item === key.replaceAll('/', ':')) {
        delayedDelete = () => remove(item, options)
        throw new Error('DELETE response lost')
      }
      return remove(item, options)
    }
    const publish = async (id: string, bytes: string) => {
      await writeFile(join(directory, asset), bytes)
      await writeFile(join(directory, '_nuxt', 'builds', 'latest.json'), JSON.stringify({ id }))
      await writeFile(join(directory, '_nuxt', 'builds', 'meta', `${id}.json`), JSON.stringify({ id }))
      // Each build uses a fresh manager, as sequential build processes do.
      const manager = createAssetManager({ driver, readConsistency: 'strong', maxNumberOfVersions: 1 })
      await manager.publishBuild(id, directory, [asset])
      return manager.getManifest()
    }

    await publish('first', 'new bytes')
    expect(delayedJournal).toBeDefined()
    await publish('second', 'replacement bytes')
    expect(delayedDelete).toBeDefined()
    await delayedJournal!()
    const manifest = await publish('third', 'new bytes')
    await delayedDelete!()

    for (const version of Object.values(manifest.versions)) {
      for (const storedKey of Object.values(version.storageKeys!))
        expect(await storage.getItemRaw(storedKey)).not.toBeNull()
    }
    expect(await storage.getItemRaw(manifest.versions.third!.storageKeys![asset]!)).toEqual(Buffer.from('new bytes'))
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
