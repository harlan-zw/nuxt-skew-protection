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

  it('removes abandoned bytes after the failed publisher is replaced', async () => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const save = driver.setItem!
    driver.setItem = (item, value, options) => {
      if (item === 'version-manifest.json')
        throw new Error('manifest unavailable')
      return save(item, value, options)
    }
    const publisher = createAssetManager({ driver })
    await expect(publisher.publishBuild('next', directory, [asset])).rejects.toThrow('manifest unavailable')
    expect(await storage.getItemRaw(key)).toEqual(Buffer.from('new bytes'))
    driver.setItem = save

    const recovered = createAssetManager({ driver })
    await recovered.cleanupExpiredVersions()
    expect(await storage.getItemRaw(key)).toBeNull()
    expect((await recovered.getManifest()).current).toBe('')
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

  it('recovers earlier batches when a later upload fails', async () => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const assets = [asset]
    for (let index = 0; index < 26; index++) {
      const path = `_nuxt/chunk-${index}.js`
      await writeFile(join(directory, path), index === 25 ? 'fail' : `chunk ${index}`)
      assets.push(path)
    }
    const upload = driver.setItemRaw!
    driver.setItemRaw = (item, value, options) => {
      if (Buffer.from(value).toString() === 'fail')
        throw new Error('later upload failed')
      return upload(item, value, options)
    }
    await expect(createAssetManager({ driver }).publishBuild('next', directory, assets)).rejects.toThrow('later upload failed')
    expect(await storage.getItemRaw(key)).toEqual(Buffer.from('new bytes'))

    await createAssetManager({ driver }).cleanupExpiredVersions()
    expect(await storage.getItemRaw(key)).toBeNull()
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

  it('retries failed object deletion on the next cleanup', async () => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const save = driver.setItem!
    driver.setItem = (item, value, options) => {
      if (item === 'version-manifest.json')
        throw new Error('manifest unavailable')
      return save(item, value, options)
    }
    await expect(createAssetManager({ driver }).publishBuild('next', directory, [asset])).rejects.toThrow('manifest unavailable')
    driver.setItem = save
    const remove = driver.removeItem!
    driver.removeItem = (item, options) => {
      if (item === key.replaceAll('/', ':'))
        throw new Error('DELETE unavailable')
      return remove(item, options)
    }
    await createAssetManager({ driver }).cleanupExpiredVersions()
    expect(await storage.getItemRaw(key)).toEqual(Buffer.from('new bytes'))
    driver.removeItem = remove

    await createAssetManager({ driver }).cleanupExpiredVersions()
    expect(await storage.getItemRaw(key)).toBeNull()
  })

  it('retries superseded object deletion after publication succeeds', async () => {
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
    expect(await storage.getItemRaw(key)).toBeNull()
    const currentKey = (await manager.getManifest()).versions.second!.storageKeys![asset]!
    expect(await storage.getItemRaw(currentKey)).toEqual(Buffer.from('newer bytes'))
  })

  it.each(['version-manifest.json', 'blobs/../version-manifest.json'])('rejects a pending deletion outside shared objects: %s', async (invalidKey) => {
    const driver = memoryDriver()
    const storage = createStorage({ driver })
    const manifest = { current: 'live', versions: {} }
    await storage.setItem('version-manifest.json', manifest)
    await storage.setItem('pending-uploads.json', { _tag: 'PendingUploads', keys: [invalidKey] })

    await expect(createAssetManager({ driver }).cleanupExpiredVersions()).rejects.toThrow('Invalid pending asset uploads')
    expect(await storage.getItem('version-manifest.json')).toEqual(manifest)
  })
})
