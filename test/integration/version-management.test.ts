import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveBuildTimeDriver } from '../../src/unstorage/utils'
import { createAssetManager } from '../../src/utils/version-manager'

describe('multi release asset lifecycle', () => {
  const testDir = join(import.meta.dirname, '.tmp', 'version-management')
  const storageDir = join(testDir, 'storage')
  const publicDir = join(testDir, 'public')

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true })
    await mkdir(storageDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  async function writeBuild(id: string, asset: string, content: string) {
    await rm(publicDir, { recursive: true, force: true })
    await mkdir(join(publicDir, '_nuxt', 'builds', 'meta'), { recursive: true })
    await writeFile(join(publicDir, asset), content)
    await writeFile(join(publicDir, '_nuxt', 'builds', 'latest.json'), JSON.stringify({ id }))
    await writeFile(join(publicDir, '_nuxt', 'builds', 'meta', `${id}.json`), JSON.stringify({ id }))
  }

  it('keeps old immutable assets addressable after a clean deployment build', async () => {
    const manager = createAssetManager({
      driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }),
      retentionDays: 7,
      maxNumberOfVersions: 5,
    })

    await writeBuild('v1', '_nuxt/entry.old.js', 'old entry')
    await manager.storeVersion('v1', publicDir, await manager.getAssetsFromBuild(publicDir))

    await writeBuild('v2', '_nuxt/entry.new.js', 'new entry')
    const currentAssets = await manager.getAssetsFromBuild(publicDir)
    await manager.storeVersion('v2', publicDir, currentAssets)
    await manager.cleanupExpiredVersions('v2')
    await manager.restoreOldAssetsToPublic('v2', publicDir, currentAssets)
    await manager.augmentBuildMetadata('v2', publicDir)

    await expect(readFile(join(publicDir, '_nuxt', 'entry.old.js'), 'utf8')).resolves.toBe('old entry')
    const latest = JSON.parse(await readFile(join(publicDir, '_nuxt', 'builds', 'latest.json'), 'utf8'))
    expect(Object.keys(latest.skewProtection.versions).sort()).toEqual(['v1', 'v2'])
  })

  it('does not restore releases removed by retention cleanup', async () => {
    const manager = createAssetManager({
      driver: await resolveBuildTimeDriver({ driver: 'fs', base: storageDir }),
      maxNumberOfVersions: 1,
    })
    await writeBuild('v1', '_nuxt/entry.old.js', 'old entry')
    await manager.storeVersion('v1', publicDir, await manager.getAssetsFromBuild(publicDir))
    await new Promise(resolve => setTimeout(resolve, 2))
    await writeBuild('v2', '_nuxt/entry.new.js', 'new entry')
    const currentAssets = await manager.getAssetsFromBuild(publicDir)
    await manager.storeVersion('v2', publicDir, currentAssets)

    await manager.cleanupExpiredVersions('v2')
    await manager.restoreOldAssetsToPublic('v2', publicDir, currentAssets)

    await expect(readFile(join(publicDir, '_nuxt', 'entry.old.js'), 'utf8')).rejects.toThrow()
    await expect(manager.listExistingVersions()).resolves.toEqual([
      expect.objectContaining({ id: 'v2' }),
    ])
  })
})
