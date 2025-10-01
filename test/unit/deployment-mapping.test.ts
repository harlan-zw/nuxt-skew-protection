import type { Storage } from 'unstorage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_VERSION_ID, DeploymentMappingManager } from '../../src/utils/deployment-mapping'

// Create mock storage (following OpenNext's mock patterns)
function createMockStorage(): Partial<Storage> {
  const store = new Map<string, any>()

  return {
    getItem: vi.fn(async (key: string) => store.get(key) || null),
    setItem: vi.fn(async (key: string, value: any) => {
      store.set(key, value)
      return undefined
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key)
      return undefined
    }),
    clear: vi.fn(async () => {
      store.clear()
      return undefined
    }),
  }
}

let mockStorage: Partial<Storage>

describe('deploymentMappingManager', () => {
  let deploymentMapping: DeploymentMappingManager

  beforeEach(() => {
    vi.clearAllMocks()
    mockStorage = createMockStorage()
    deploymentMapping = new DeploymentMappingManager(mockStorage as Storage)
  })

  describe('updateMapping', () => {
    it('should create new mapping with current deployment', async () => {
      mockStorage.getItem.mockResolvedValue({})

      const result = await deploymentMapping.updateMapping('new-deployment', [], 20)

      expect(result).toEqual({
        'new-deployment': CURRENT_VERSION_ID,
      })
      expect(mockStorage.setItem).toHaveBeenCalledWith('deployment-mapping.json', {
        'new-deployment': CURRENT_VERSION_ID,
      })
    })

    it('should replace current with actual version for existing deployments', async () => {
      const existingMapping = {
        'old-deployment': CURRENT_VERSION_ID,
        'older-deployment': 'version-123',
      }
      mockStorage.getItem.mockResolvedValue(existingMapping)

      const versions = [
        { id: 'version-456', createdAt: Date.now() },
        { id: 'version-123', createdAt: Date.now() - 1000 },
      ]

      const result = await deploymentMapping.updateMapping('new-deployment', versions, 20)

      expect(result).toEqual({
        'new-deployment': CURRENT_VERSION_ID,
        'old-deployment': 'version-456', // Current replaced with latest version
        'older-deployment': 'version-123', // Existing version kept
      })
    })

    it('should remove mappings for non-existent versions', async () => {
      const existingMapping = {
        'deployment-1': 'version-exists',
        'deployment-2': 'version-missing',
        'deployment-3': CURRENT_VERSION_ID,
      }
      mockStorage.getItem.mockResolvedValue(existingMapping)

      const versions = [
        { id: 'version-exists', createdAt: Date.now() },
        { id: 'version-new', createdAt: Date.now() - 1000 },
      ]

      const result = await deploymentMapping.updateMapping('new-deployment', versions, 20)

      expect(result).toEqual({
        'new-deployment': CURRENT_VERSION_ID,
        'deployment-1': 'version-exists', // Version exists, kept
        'deployment-3': 'version-exists', // Current replaced with latest
        // deployment-2 removed because version-missing doesn't exist
      })
    })

    it('should respect max versions limit', async () => {
      mockStorage.getItem.mockResolvedValue({})

      const manyVersions = Array.from({ length: 25 }, (_, i) => ({
        id: `version-${i}`,
        createdAt: Date.now() - (i * 1000),
      }))

      await deploymentMapping.updateMapping('new-deployment', manyVersions, 20)

      // Should only consider first 20 versions (newest)
      const storedMapping = mockStorage.setItem.mock.calls[0][1]
      expect(Object.keys(storedMapping)).toHaveLength(1) // Only new deployment
    })
  })

  describe('getVersionForDeployment', () => {
    it('should return version for existing deployment', async () => {
      mockStorage.getItem.mockResolvedValue({
        'deployment-1': 'version-123',
      })

      const result = await deploymentMapping.getVersionForDeployment('deployment-1')
      expect(result).toBe('version-123')
    })

    it('should return null for non-existent deployment', async () => {
      mockStorage.getItem.mockResolvedValue({})

      const result = await deploymentMapping.getVersionForDeployment('missing-deployment')
      expect(result).toBeNull()
    })
  })

  describe('isDeploymentIdUsed', () => {
    it('should return true for existing deployment', async () => {
      mockStorage.getItem.mockResolvedValue({
        'existing-deployment': 'version-123',
      })

      const result = await deploymentMapping.isDeploymentIdUsed('existing-deployment')
      expect(result).toBe(true)
    })

    it('should return false for new deployment', async () => {
      mockStorage.getItem.mockResolvedValue({})

      const result = await deploymentMapping.isDeploymentIdUsed('new-deployment')
      expect(result).toBe(false)
    })
  })

  describe('cleanupStaleDeployments', () => {
    it('should remove deployments with invalid versions', async () => {
      const mapping = {
        'deployment-1': 'valid-version',
        'deployment-2': 'invalid-version',
        'deployment-3': CURRENT_VERSION_ID,
      }
      mockStorage.getItem.mockResolvedValue(mapping)

      await deploymentMapping.cleanupStaleDeployments(['valid-version'])

      expect(mockStorage.setItem).toHaveBeenCalledWith('deployment-mapping.json', {
        'deployment-1': 'valid-version',
        'deployment-3': CURRENT_VERSION_ID,
      })
    })

    it('should preserve current deployments', async () => {
      const mapping = {
        'current-deployment': CURRENT_VERSION_ID,
        'old-deployment': 'invalid-version',
      }
      mockStorage.getItem.mockResolvedValue(mapping)

      await deploymentMapping.cleanupStaleDeployments([])

      expect(mockStorage.setItem).toHaveBeenCalledWith('deployment-mapping.json', {
        'current-deployment': CURRENT_VERSION_ID,
      })
    })
  })
})
