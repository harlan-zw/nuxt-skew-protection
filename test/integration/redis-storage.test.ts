import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'pathe'
import { createStorage } from 'unstorage'
import redisDriver from 'unstorage/drivers/redis'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAssetManager } from '../../src/utils/version-manager'

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  base: 'test:skew-protection',
}

function createRedisStorage() {
  return createStorage({ driver: redisDriver(redisConfig) })
}

async function isRedisAvailable() {
  const storage = createRedisStorage()
  return Promise.race([
    storage.setItem('probe', 'ok').then(() => true),
    new Promise<boolean>(resolve => setTimeout(resolve, 1000, false)),
  ]).catch(() => false).finally(() => storage.dispose())
}

const redisAvailable = await isRedisAvailable()

describe.skipIf(!redisAvailable)('redis asset storage', () => {
  const testDir = join(import.meta.dirname, '.tmp', 'redis')
  const publicDir = join(testDir, 'public')
  let storage = createRedisStorage()

  beforeAll(async () => {
    const bootstrap = createRedisStorage()
    await bootstrap.removeItem('probe')
    await bootstrap.dispose()
  })

  beforeEach(async () => {
    storage = createRedisStorage()
    await storage.clear()
    await rm(testDir, { recursive: true, force: true })
    await mkdir(join(publicDir, '_nuxt'), { recursive: true })
  })

  afterEach(async () => {
    await storage.dispose()
    await rm(testDir, { recursive: true, force: true })
  })

  afterAll(async () => {
    const cleanup = createRedisStorage()
    await cleanup.clear()
    await cleanup.dispose()
  })

  it('stores isolated release records and binary assets', async () => {
    const manager = createAssetManager({ storage })
    await writeFile(join(publicDir, '_nuxt', 'entry.js'), 'entry')
    await manager.storeVersion('v1', publicDir, ['_nuxt/entry.js'])

    await expect(manager.getManifest('v1')).resolves.toMatchObject({
      current: 'v1',
      versions: { v1: { assets: ['_nuxt/entry.js'] } },
    })
    const stored = await storage.getItemRaw('version-assets/v1/_nuxt/entry.js')
    expect(Buffer.from(stored as Uint8Array).toString()).toBe('entry')
  })

  it('removes release assets with expired count retention', async () => {
    const manager = createAssetManager({ storage, maxNumberOfVersions: 1 })
    await writeFile(join(publicDir, '_nuxt', 'old.js'), 'old')
    await manager.storeVersion('v1', publicDir, ['_nuxt/old.js'])
    await new Promise(resolve => setTimeout(resolve, 2))
    await writeFile(join(publicDir, '_nuxt', 'new.js'), 'new')
    await manager.storeVersion('v2', publicDir, ['_nuxt/new.js'])

    await manager.cleanupExpiredVersions('v2')

    await expect(manager.listExistingVersions()).resolves.toEqual([
      expect.objectContaining({ id: 'v2' }),
    ])
    await expect(storage.getItemRaw('version-assets/v1/_nuxt/old.js')).resolves.toBeNull()
  })

  it('rejects an immutable URL whose bytes changed', async () => {
    const manager = createAssetManager({ storage })
    const path = join(publicDir, '_nuxt', 'entry.js')
    await writeFile(path, 'v1')
    await manager.storeVersion('v1', publicDir, ['_nuxt/entry.js'])
    await writeFile(path, 'v2')

    await expect(
      manager.storeVersion('v2', publicDir, ['_nuxt/entry.js']),
    ).rejects.toThrow('changed without changing its URL')
  })
})
