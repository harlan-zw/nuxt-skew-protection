import type { Storage } from 'unstorage'
import { getSkewProtectionStorage } from './storage'

export interface DeploymentMappingEntry {
  deploymentId: string
  versionId: string
  createdAt: number
  isLatest: boolean
}

export interface DeploymentMapping {
  [deploymentId: string]: string
}

export const CURRENT_VERSION_ID = 'current'
export const DEPLOYMENT_MAPPING_KEY = 'deployment-mapping.json'

export class DeploymentMappingManager {
  private storage: Storage

  constructor(customStorage?: Storage) {
    this.storage = customStorage || getSkewProtectionStorage()
  }

  async getMapping(): Promise<DeploymentMapping> {
    try {
      const mapping = await this.storage.getItem(DEPLOYMENT_MAPPING_KEY) as DeploymentMapping
      return mapping || {}
    }
    catch {
      return {}
    }
  }

  async updateMapping(
    newDeploymentId: string,
    existingVersions: { id: string, createdAt: number }[],
    maxVersions: number = 20,
  ): Promise<DeploymentMapping> {
    const existingMapping = await this.getMapping()
    const newMapping: DeploymentMapping = { [newDeploymentId]: CURRENT_VERSION_ID }

    // Sort versions by creation time (newest first)
    const sortedVersions = existingVersions
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, maxVersions)

    const versionIds = new Set(sortedVersions.map(v => v.id))

    // Replace "current" with actual version ID for existing deployments
    for (const [deploymentId, versionId] of Object.entries(existingMapping)) {
      if (versionId === CURRENT_VERSION_ID && sortedVersions.length > 0) {
        // Replace "current" with the latest actual version
        newMapping[deploymentId] = sortedVersions[0]!.id
      }
      else if (versionIds.has(versionId)) {
        // Keep existing mapping if version still exists
        newMapping[deploymentId] = versionId
      }
      // Skip mappings for versions that no longer exist
    }

    await this.storage.setItem(DEPLOYMENT_MAPPING_KEY, newMapping)
    return newMapping
  }

  async getVersionForDeployment(deploymentId: string): Promise<string | null> {
    const mapping = await this.getMapping()
    return mapping[deploymentId] || null
  }

  async isDeploymentIdUsed(deploymentId: string): Promise<boolean> {
    const mapping = await this.getMapping()
    return deploymentId in mapping
  }

  async getActiveDeployments(): Promise<string[]> {
    const mapping = await this.getMapping()
    return Object.keys(mapping)
  }

  async removeDeployment(deploymentId: string): Promise<void> {
    const mapping = await this.getMapping()
    delete mapping[deploymentId]
    await this.storage.setItem(DEPLOYMENT_MAPPING_KEY, mapping)
  }

  async cleanupStaleDeployments(
    validVersions: string[],
    maxAge: number = 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  ): Promise<void> {
    const mapping = await this.getMapping()
    const now = Date.now()
    const validVersionSet = new Set(validVersions)

    const cleanedMapping: DeploymentMapping = {}

    for (const [deploymentId, versionId] of Object.entries(mapping)) {
      // Keep current deployments and versions that still exist
      if (versionId === CURRENT_VERSION_ID || validVersionSet.has(versionId)) {
        cleanedMapping[deploymentId] = versionId
      }
    }

    await this.storage.setItem(DEPLOYMENT_MAPPING_KEY, cleanedMapping)
  }
}

let _deploymentMapping: DeploymentMappingManager | null = null

export function getDeploymentMapping(): DeploymentMappingManager {
  if (!_deploymentMapping) {
    _deploymentMapping = new DeploymentMappingManager()
  }
  return _deploymentMapping
}
