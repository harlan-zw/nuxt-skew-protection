import { promises as fs } from 'node:fs'
import { dirname, join } from 'pathe'
import { createStorage } from 'unstorage'

export interface VersionManifest {
  current: string
  versions: Record<string, {
    timestamp: string
    expires: string
    assets: string[]
  }>
}

export function createAssetManager(options: any) {
  const storage = options.storage ? createStorage(options.storage) : createStorage()

  async function getFilesRecursively(dir: string): Promise<string[]> {
    const files: string[] = []

    const items = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])

    for (const item of items) {
      const fullPath = join(dir, item.name)

      if (item.isDirectory()) {
        const subFiles = await getFilesRecursively(fullPath)
        files.push(...subFiles)
      }
      else {
        files.push(fullPath)
      }
    }

    return files
  }

  async function copyAssetsToVersionedDirectory(buildId: string, outputDir: string) {
    const versionDir = join(outputDir, 'public', '_versions', buildId)
    const nuxtDir = join(outputDir, 'public', '_nuxt')

    // Ensure version directory exists
    await fs.mkdir(versionDir, { recursive: true })

    // Copy all _nuxt assets to the versioned directory
    const assets: string[] = []
    const nuxtFiles = await getFilesRecursively(nuxtDir)

    for (const file of nuxtFiles) {
      const relativePath = file.replace(nuxtDir, '')
      const destPath = join(versionDir, '_nuxt', relativePath)
      const destDir = dirname(destPath)

      await fs.mkdir(destDir, { recursive: true })
      await fs.copyFile(file, destPath).catch((error) => {
        if (options.debug) {
          console.warn(`[skew-protection] Failed to copy ${file}:`, error)
        }
      })

      assets.push(`_nuxt${relativePath}`)
    }

    if (options.debug) {
      console.log(`[skew-protection] Copied ${assets.length} assets for version ${buildId}`)
    }

    return assets
  }

  async function updateVersionsManifest(buildId: string, assets: string[]) {
    const now = new Date()
    const expires = new Date(now.getTime() + (options.retentionDays * 24 * 60 * 60 * 1000))

    // Get existing manifest
    const existingManifest = await storage.getItem('versions-manifest.json').catch(() => ({
      current: buildId,
      versions: {},
    })) as VersionManifest

    // Update manifest with new version
    existingManifest.current = buildId
    existingManifest.versions[buildId] = {
      timestamp: now.toISOString(),
      expires: expires.toISOString(),
      assets,
    }

    // Store updated manifest
    await storage.setItem('versions-manifest.json', existingManifest)

    if (options.debug) {
      console.log(`[skew-protection] Updated manifest with version ${buildId}`)
    }

    return existingManifest
  }

  async function cleanupExpiredVersions(outputDir: string) {
    const manifest = await storage.getItem('versions-manifest.json').catch(() => null) as VersionManifest
    if (!manifest)
      return

    const now = new Date()
    const versionsDir = join(outputDir, 'public', '_versions')
    let cleanedCount = 0

    // Get all versions sorted by timestamp (newest first)
    const sortedVersions = Object.entries(manifest.versions)
      .map(([id, data]) => ({ id, ...data, timestamp: new Date(data.timestamp).getTime() }))
      .sort((a, b) => b.timestamp - a.timestamp)

    // Apply both age-based and count-based cleanup
    const maxAge = options.retentionDays * 24 * 60 * 60 * 1000
    const maxVersions = options.maxNumberOfVersions || 20

    for (let i = 0; i < sortedVersions.length; i++) {
      const version = sortedVersions[i]!
      const isExpired = (now.getTime() - version.timestamp) > maxAge
      const exceedsCount = i >= maxVersions
      const isCurrent = version.id === manifest.current

      // Skip current version and keep at least one version
      if (isCurrent || (i === 0 && sortedVersions.length === 1)) {
        continue
      }

      // Remove if expired or exceeds count limit
      if (isExpired || exceedsCount) {
        // Remove from filesystem
        const versionPath = join(versionsDir, version.id)
        await fs.rm(versionPath, { recursive: true, force: true }).catch((error) => {
          if (options.debug) {
            console.warn(`[skew-protection] Failed to remove ${versionPath}:`, error)
          }
        })

        // Remove from storage
        const assetPromises = version.assets.map(asset =>
          storage.removeItem(`${version.id}/${asset}`).catch((error) => {
            if (options.debug) {
              console.warn(`[skew-protection] Failed to remove asset ${asset}:`, error)
            }
          }),
        )
        await Promise.all(assetPromises)

        // Remove from manifest
        delete manifest.versions[version.id]
        cleanedCount++

        if (options.debug) {
          console.log(`[skew-protection] Removed version ${version.id} (${isExpired ? 'expired' : 'exceeded count limit'})`)
        }
      }
    }

    if (cleanedCount > 0) {
      await storage.setItem('versions-manifest.json', manifest)
      if (options.debug) {
        console.log(`[skew-protection] Cleaned up ${cleanedCount} versions`)
      }
    }
  }

  async function storeAssetsInStorage(buildId: string, outputDir: string, assets: string[]) {
    const versionDir = join(outputDir, 'public', '_versions', buildId)

    for (const asset of assets) {
      const assetPath = join(versionDir, asset)
      const assetData = await fs.readFile(assetPath).catch((error) => {
        if (options.debug) {
          console.warn(`[skew-protection] Failed to read ${assetPath}:`, error)
        }
        return null
      })

      if (assetData) {
        const storageKey = `${buildId}/${asset}`
        await storage.setItem(storageKey, assetData).catch((error) => {
          if (options.debug) {
            console.warn(`[skew-protection] Failed to store ${storageKey}:`, error)
          }
        })
      }
    }

    if (options.debug) {
      console.log(`[skew-protection] Stored ${assets.length} assets in storage for version ${buildId}`)
    }
  }

  async function listExistingVersions(): Promise<{ id: string, createdAt: number }[]> {
    const manifest = await storage.getItem('versions-manifest.json').catch(() => null) as VersionManifest
    if (!manifest)
      return []

    return Object.entries(manifest.versions).map(([id, data]) => ({
      id,
      createdAt: new Date(data.timestamp).getTime(),
    }))
  }

  return {
    copyAssetsToVersionedDirectory,
    updateVersionsManifest,
    cleanupExpiredVersions,
    storeAssetsInStorage,
    listExistingVersions,
  }
}
