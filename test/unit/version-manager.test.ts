import type { Storage } from 'unstorage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAssetManager, CURRENT_VERSION_ID } from '../../src/utils/version-manager'

// Create mock storage that actually stores values
function createMockStorage() {
  const store = new Map<string, any>()

  return {
    getItem: async (key: string) => store.get(key) || null,
    setItem: async (key: string, value: any) => {
      store.set(key, value)
    },
    removeItem: async (key: string) => {
      store.delete(key)
    },
    clear: async () => {
      store.clear()
    },
  } as Storage
}

let mockStorage: Storage

describe('assetManager deployment mapping', () => {
  let assetManager: ReturnType<typeof createAssetManager>

  beforeEach(() => {
    vi.clearAllMocks()
    mockStorage = createMockStorage()
    assetManager = createAssetManager({ storage: mockStorage })
  })

  describe('updateDeploymentMapping', () => {
    it('should create new mapping with current deployment', async () => {
      await assetManager.updateDeploymentMapping('new-deployment', [])

      const manifest = await mockStorage.getItem('version-manifest.json')
      expect(manifest.deploymentMapping).toEqual({
        'new-deployment': CURRENT_VERSION_ID,
      })
    })

    it('should replace current with actual version for existing deployments', async () => {
      await mockStorage.setItem('version-manifest.json', {
        current: '',
        versions: {},
        deploymentMapping: {
          'old-deployment': CURRENT_VERSION_ID,
          'older-deployment': 'version-123',
        },
      })

      const versions = [
        { id: 'version-456', createdAt: Date.now() },
        { id: 'version-123', createdAt: Date.now() - 1000 },
      ]

      await assetManager.updateDeploymentMapping('new-deployment', versions)

      const manifest = await mockStorage.getItem('version-manifest.json')
      expect(manifest.deploymentMapping).toEqual({
        'new-deployment': CURRENT_VERSION_ID,
        'old-deployment': 'version-456',
        'older-deployment': 'version-123',
      })
    })

    it('should remove mappings for non-existent versions', async () => {
      await mockStorage.setItem('version-manifest.json', {
        current: '',
        versions: {},
        deploymentMapping: {
          'deployment-1': 'version-exists',
          'deployment-2': 'version-missing',
          'deployment-3': CURRENT_VERSION_ID,
        },
      })

      const versions = [
        { id: 'version-exists', createdAt: Date.now() },
        { id: 'version-new', createdAt: Date.now() - 1000 },
      ]

      await assetManager.updateDeploymentMapping('new-deployment', versions)

      const manifest = await mockStorage.getItem('version-manifest.json')
      expect(manifest.deploymentMapping).toEqual({
        'new-deployment': CURRENT_VERSION_ID,
        'deployment-1': 'version-exists',
        'deployment-3': 'version-exists',
      })
    })

    it('should respect max versions limit', async () => {
      const manyVersions = Array.from({ length: 25 }, (_, i) => ({
        id: `version-${i}`,
        createdAt: Date.now() - (i * 1000),
      }))

      await assetManager.updateDeploymentMapping('new-deployment', manyVersions)

      const manifest = await mockStorage.getItem('version-manifest.json')
      expect(Object.keys(manifest.deploymentMapping)).toHaveLength(1)
    })
  })

  describe('getVersionForDeployment', () => {
    it('should return version for existing deployment', async () => {
      await mockStorage.setItem('version-manifest.json', {
        current: '',
        versions: {},
        deploymentMapping: {
          'deployment-1': 'version-123',
        },
      })

      const result = await assetManager.getVersionForDeployment('deployment-1')
      expect(result).toBe('version-123')
    })

    it('should return null for non-existent deployment', async () => {
      await mockStorage.setItem('version-manifest.json', {
        current: '',
        versions: {},
        deploymentMapping: {},
      })

      const result = await assetManager.getVersionForDeployment('missing-deployment')
      expect(result).toBeNull()
    })
  })

  describe('isDeploymentIdUsed', () => {
    it('should return true for existing deployment', async () => {
      await mockStorage.setItem('version-manifest.json', {
        current: '',
        versions: {},
        deploymentMapping: {
          'existing-deployment': 'version-123',
        },
      })

      const result = await assetManager.isDeploymentIdUsed('existing-deployment')
      expect(result).toBe(true)
    })

    it('should return false for new deployment', async () => {
      await mockStorage.setItem('version-manifest.json', {
        current: '',
        versions: {},
      })

      const result = await assetManager.isDeploymentIdUsed('new-deployment')
      expect(result).toBe(false)
    })
  })
})
