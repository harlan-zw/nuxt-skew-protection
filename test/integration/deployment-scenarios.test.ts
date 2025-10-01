import type { Storage } from 'unstorage'
import { afterEach, beforeEach, describe, expect } from 'vitest'
import { DeploymentMappingManager } from '../../src/utils/deployment-mapping'
import { createMockStorage } from '../../src/utils/storage'

describe('deployment Scenarios Integration Tests', () => {
  let storage: Storage
  let deploymentMapping: DeploymentMappingManager

  beforeEach(() => {
    storage = createMockStorage()
    deploymentMapping = new DeploymentMappingManager(storage)
  })

  afterEach(() => {
    // Clean up any test data
  })

  describe('initial Deployment', () => {
    it('handles first deployment correctly', async () => {
      const deploymentId = 'initial-deployment-v1.0.0'
      const versions = [{ id: 'version-abc123', createdAt: Date.now() }]

      const mapping = await deploymentMapping.updateMapping(deploymentId, versions, 20)

      expect(mapping).toEqual({
        [deploymentId]: 'current',
      })

      const isUsed = await deploymentMapping.isDeploymentIdUsed(deploymentId)
      expect(isUsed).toBe(true)
    })

    it('prevents deployment ID collision', async () => {
      const deploymentId = 'duplicate-deployment'
      const versions = [{ id: 'version-123', createdAt: Date.now() }]

      // First deployment
      await deploymentMapping.updateMapping(deploymentId, versions, 20)

      // Second deployment with same ID should be detectable
      const isUsed = await deploymentMapping.isDeploymentIdUsed(deploymentId)
      expect(isUsed).toBe(true)
    })
  })

  describe('rolling Deployment', () => {
    it('handles rolling deployment with version promotion', async () => {
      // Initial state: one deployment
      const oldDeploymentId = 'deployment-v1'
      const oldVersions = [{ id: 'version-old', createdAt: Date.now() - 10000 }]

      await deploymentMapping.updateMapping(oldDeploymentId, oldVersions, 20)

      // New deployment
      const newDeploymentId = 'deployment-v2'
      const newVersions = [
        { id: 'version-new', createdAt: Date.now() },
        { id: 'version-old', createdAt: Date.now() - 10000 },
      ]

      const mapping = await deploymentMapping.updateMapping(newDeploymentId, newVersions, 20)

      expect(mapping).toEqual({
        [oldDeploymentId]: 'version-new', // Previous current becomes latest version
        [newDeploymentId]: 'current', // New deployment gets current
      })
    })

    it('handles multiple concurrent deployments', async () => {
      const deployments = [
        { id: 'deployment-a', version: 'version-a' },
        { id: 'deployment-b', version: 'version-b' },
        { id: 'deployment-c', version: 'version-c' },
      ]

      const allVersions = deployments.map((d, i) => ({
        id: d.version,
        createdAt: Date.now() - (i * 1000),
      }))

      // Deploy in sequence
      for (const deployment of deployments) {
        await deploymentMapping.updateMapping(deployment.id, allVersions, 20)
      }

      const finalMapping = await deploymentMapping.getMapping()

      // Only the last deployment should be current
      expect(finalMapping['deployment-c']).toBe('current')

      // Previous deployments should be mapped to actual versions
      expect(finalMapping['deployment-a']).toBe('version-c')
      expect(finalMapping['deployment-b']).toBe('version-c')
    })
  })

  describe('blue-Green Deployment', () => {
    it('handles blue-green deployment switch', async () => {
      // Blue environment
      const blueDeploymentId = 'blue-environment'
      const blueVersions = [{ id: 'blue-version', createdAt: Date.now() - 5000 }]

      await deploymentMapping.updateMapping(blueDeploymentId, blueVersions, 20)

      // Green environment (new version)
      const greenDeploymentId = 'green-environment'
      const greenVersions = [
        { id: 'green-version', createdAt: Date.now() },
        { id: 'blue-version', createdAt: Date.now() - 5000 },
      ]

      await deploymentMapping.updateMapping(greenDeploymentId, greenVersions, 20)

      const mapping = await deploymentMapping.getMapping()

      // Green should be current, blue should be mapped to green version
      expect(mapping[greenDeploymentId]).toBe('current')
      expect(mapping[blueDeploymentId]).toBe('green-version')

      // Can still resolve both environments
      const blueVersion = await deploymentMapping.getVersionForDeployment(blueDeploymentId)
      const greenVersion = await deploymentMapping.getVersionForDeployment(greenDeploymentId)

      expect(blueVersion).toBe('green-version')
      expect(greenVersion).toBe('current')
    })
  })

  describe('canary Deployment', () => {
    it('handles canary deployment alongside production', async () => {
      // Production deployment
      const prodDeploymentId = 'production-v1.0.0'
      const prodVersions = [{ id: 'prod-version', createdAt: Date.now() - 10000 }]

      await deploymentMapping.updateMapping(prodDeploymentId, prodVersions, 20)

      // Canary deployment (subset of traffic)
      const canaryDeploymentId = 'canary-v1.1.0'
      const canaryVersions = [
        { id: 'canary-version', createdAt: Date.now() },
        { id: 'prod-version', createdAt: Date.now() - 10000 },
      ]

      await deploymentMapping.updateMapping(canaryDeploymentId, canaryVersions, 20)

      const mapping = await deploymentMapping.getMapping()

      // Both deployments should exist
      expect(mapping[prodDeploymentId]).toBeDefined()
      expect(mapping[canaryDeploymentId]).toBe('current')

      // Production traffic should get the canary version (latest)
      expect(mapping[prodDeploymentId]).toBe('canary-version')
    })

    it('handles canary rollback scenario', async () => {
      // Setup: production and canary
      const prodDeploymentId = 'production'
      const canaryDeploymentId = 'canary'

      // Initial production version
      await deploymentMapping.updateMapping(prodDeploymentId, [
        { id: 'prod-v1', createdAt: Date.now() - 20000 },
      ], 20)

      // Canary deployment
      await deploymentMapping.updateMapping(canaryDeploymentId, [
        { id: 'canary-v2', createdAt: Date.now() - 10000 },
        { id: 'prod-v1', createdAt: Date.now() - 20000 },
      ], 20)

      // Rollback: new production deployment without canary version
      await deploymentMapping.updateMapping('production-rollback', [
        { id: 'prod-v1', createdAt: Date.now() - 20000 },
      ], 20)

      const mapping = await deploymentMapping.getMapping()

      // Canary should still exist but not be the latest
      expect(mapping[canaryDeploymentId]).toBe('prod-v1')
      expect(mapping['production-rollback']).toBe('current')
    })
  })

  describe('version Cleanup Scenarios', () => {
    it('handles cleanup with active deployments', async () => {
      const deployments = []
      const versions = []

      // Create multiple deployments over time
      for (let i = 0; i < 25; i++) {
        const deploymentId = `deployment-${i}`
        const versionId = `version-${i}`

        deployments.push(deploymentId)
        versions.push({
          id: versionId,
          createdAt: Date.now() - (i * 1000),
        })

        await deploymentMapping.updateMapping(deploymentId, versions, 20)
      }

      // Cleanup with max 20 versions
      const validVersionIds = versions.slice(0, 20).map(v => v.id)
      await deploymentMapping.cleanupStaleDeployments(validVersionIds)

      const mapping = await deploymentMapping.getMapping()

      // Should have at most 20 deployments (current + 19 previous)
      expect(Object.keys(mapping).length).toBeLessThanOrEqual(20)

      // Latest deployment should still be current
      expect(mapping['deployment-24']).toBe('current')

      // Verify no mappings to deleted versions
      const allMappedVersions = Object.values(mapping)
      for (const version of allMappedVersions) {
        if (version !== 'current') {
          expect(validVersionIds).toContain(version)
        }
      }
    })

    it('preserves current deployments during cleanup', async () => {
      const currentDeploymentId = 'current-deployment'
      const oldDeploymentId = 'old-deployment'

      // Create current deployment
      await deploymentMapping.updateMapping(currentDeploymentId, [
        { id: 'current-version', createdAt: Date.now() },
      ], 20)

      // Create old deployment that maps to deleted version
      await deploymentMapping.updateMapping(oldDeploymentId, [
        { id: 'current-version', createdAt: Date.now() },
        { id: 'old-version', createdAt: Date.now() - 10000 },
      ], 20)

      // Cleanup - old version is no longer valid
      await deploymentMapping.cleanupStaleDeployments(['current-version'])

      const mapping = await deploymentMapping.getMapping()

      // Current deployment should still exist
      expect(mapping[currentDeploymentId]).toBe('current-version')

      // Old deployment should be removed because it mapped to deleted version
      expect(mapping[oldDeploymentId]).toBeUndefined()
    })
  })

  describe('error Recovery Scenarios', () => {
    it('handles corrupted deployment mapping', async () => {
      // Simulate corrupted data
      await storage.setItem('deployment-mapping.json', 'invalid json')

      // Should recover gracefully
      const mapping = await deploymentMapping.getMapping()
      expect(mapping).toEqual({})

      // Should be able to create new mapping
      const newMapping = await deploymentMapping.updateMapping('recovery-deployment', [
        { id: 'recovery-version', createdAt: Date.now() },
      ], 20)

      expect(newMapping).toEqual({
        'recovery-deployment': 'current',
      })
    })

    it('handles storage failures gracefully', async () => {
      // Create a storage that fails
      const failingStorage = {
        ...storage,
        getItem: async () => { throw new Error('Storage unavailable') },
        setItem: async () => { throw new Error('Storage unavailable') },
      }

      const failingMapping = new DeploymentMappingManager(failingStorage as Storage)

      // Should not crash, should return empty mapping
      const mapping = await failingMapping.getMapping()
      expect(mapping).toEqual({})

      // Should handle version lookup gracefully
      const version = await failingMapping.getVersionForDeployment('any-deployment')
      expect(version).toBeNull()
    })
  })

  describe('high Availability Scenarios', () => {
    it('handles rapid deployment sequence', async () => {
      const deploymentPromises = []

      // Simulate rapid deployments
      for (let i = 0; i < 10; i++) {
        const promise = deploymentMapping.updateMapping(
          `rapid-deployment-${i}`,
          [{ id: `version-${i}`, createdAt: Date.now() + i }],
          20,
        )
        deploymentPromises.push(promise)
      }

      // All should complete without error
      const results = await Promise.all(deploymentPromises)
      expect(results).toHaveLength(10)

      // Final state should be consistent
      const finalMapping = await deploymentMapping.getMapping()
      expect(finalMapping['rapid-deployment-9']).toBe('current')
    })

    it('handles concurrent version resolution', async () => {
      // Setup deployments
      await deploymentMapping.updateMapping('deployment-1', [
        { id: 'version-1', createdAt: Date.now() },
      ], 20)

      await deploymentMapping.updateMapping('deployment-2', [
        { id: 'version-2', createdAt: Date.now() },
        { id: 'version-1', createdAt: Date.now() - 1000 },
      ], 20)

      // Concurrent resolution requests
      const resolutionPromises = [
        deploymentMapping.getVersionForDeployment('deployment-1'),
        deploymentMapping.getVersionForDeployment('deployment-2'),
        deploymentMapping.getVersionForDeployment('non-existent'),
        deploymentMapping.getVersionForDeployment('deployment-1'),
        deploymentMapping.getVersionForDeployment('deployment-2'),
      ]

      const results = await Promise.all(resolutionPromises)

      expect(results[0]).toBe('version-2') // deployment-1 maps to latest
      expect(results[1]).toBe('current') // deployment-2 is current
      expect(results[2]).toBeNull() // non-existent
      expect(results[3]).toBe('version-2') // same as first
      expect(results[4]).toBe('current') // same as second
    })
  })
})
