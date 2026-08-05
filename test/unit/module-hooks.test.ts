import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveBuildTimeDriver } from '../../src/unstorage/utils'
import { createAssetManager } from '../../src/utils/version-manager'

describe('build hook asset lifecycle', () => {
  const testDir = join(import.meta.dirname, '.tmp', 'module-hooks')
  const storageDir = join(testDir, 'storage')
  const publicDir = join(testDir, 'public')

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true })
    await mkdir(storageDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('stores, cleans, restores, then advertises retained releases', async () => {
    const manager = createAssetManager({
      driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }),
      maxNumberOfVersions: 2,
    })
    await mkdir(join(publicDir, '_nuxt'), { recursive: true })
    await writeFile(join(publicDir, '_nuxt', 'old.js'), 'old')
    await manager.storeVersion('v1', publicDir, ['_nuxt/old.js'])

    await rm(publicDir, { recursive: true })
    await mkdir(join(publicDir, '_nuxt', 'builds', 'meta'), { recursive: true })
    await writeFile(join(publicDir, '_nuxt', 'new.js'), 'new')
    await writeFile(join(publicDir, '_nuxt', 'builds', 'latest.json'), JSON.stringify({ id: 'v2' }))
    await writeFile(join(publicDir, '_nuxt', 'builds', 'meta', 'v2.json'), JSON.stringify({ id: 'v2' }))
    const assets = await manager.getAssetsFromBuild(publicDir)

    await manager.storeVersion('v2', publicDir, assets)
    await manager.cleanupExpiredVersions('v2')
    await manager.restoreOldAssetsToPublic('v2', publicDir, assets)
    await manager.augmentBuildMetadata('v2', publicDir)

    await expect(readFile(join(publicDir, '_nuxt', 'old.js'), 'utf8')).resolves.toBe('old')
    const latest = JSON.parse(await readFile(join(publicDir, '_nuxt', 'builds', 'latest.json'), 'utf8'))
    expect(Object.keys(latest.skewProtection.versions).sort()).toEqual(['v1', 'v2'])
  })
})
