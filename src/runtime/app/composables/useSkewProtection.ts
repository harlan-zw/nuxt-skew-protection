import type { Ref } from 'vue'
import type { ModuleInvalidatedPayload } from '../../types'
import { useNuxtApp, useRuntimeConfig } from '#app'
import { computed, onUnmounted } from 'vue'
import { logger } from '../../shared/logger'

export interface VersionInfo {
  currentVersion: string
  latestVersion: string
  outdated: boolean
  clientVersion: string
}

export interface DeploymentInfo {
  id: string
  timestamp?: number
  releaseDate?: Date
}

export interface SkewProtectionPlugin {
  versionMismatch: Ref<{
    detected: boolean
    newVersion: string
    currentVersion: string
    reason?: 'manifest' | 'sse'
  }>
  versionCookie: Ref<string>
  currentBuildId: string
  handleVersionMismatch: (newVersion: string, currentVersion: string, reason?: 'manifest' | 'sse') => Promise<void>
  updateVersion: (version: string) => void
  dismiss: () => void
  reload: () => void
}

export function useSkewProtection() {
  const nuxtApp = useNuxtApp()

  // // Reactive state from the plugin
  const versionMismatch = computed(() => {
    return {
      detected: false,
      newVersion: '',
      currentVersion: '',
      reason: undefined as 'manifest' | 'sse' | undefined,
    }
  })
  const currentBuildId = computed(() => $skewProtection.currentBuildId)

  // Computed properties for easier access
  const isOutdated = computed(() => versionMismatch.value.detected)
  const newVersion = computed(() => versionMismatch.value.newVersion)
  const detectionReason = computed(() => versionMismatch.value.reason)

  /**
   * Get deployment information including release date
   */
  async function getDeploymentInfo(version?: string): Promise<DeploymentInfo | null> {
    const targetVersion = version || currentBuildId.value
    return $fetch(`/_skew/status`)
      .then((response) => {
        if (response && typeof response === 'object') {
          // Find the deployment info for the specified version
          const deployments = (response as any).deployments || []
          const deployment = deployments.find((d: any) => d.id === targetVersion)

          if (deployment) {
            return {
              id: deployment.id,
              timestamp: deployment.timestamp,
              releaseDate: deployment.timestamp ? new Date(deployment.timestamp) : undefined,
            }
          }

          // If not found in deployments, return basic info
          return {
            id: targetVersion,
          }
        }

        return null
      })
      .catch((error) => {
        logger.warn('Failed to get deployment info:', error)
        return null
      })
  }

  /**
   * Calculate how many versions behind the current version is
   */
  async function getVersionsBehind(): Promise<number> {
    return $fetch('/_skew/debug')
      .then((response) => {
        if (response && typeof response === 'object') {
          const deployments = (response as any).deployments || []
          const currentIdx = deployments.findIndex((d: any) => d.id === currentVersion.value)
          const latestIdx = deployments.findIndex((d: any) => d.id === newVersion.value)

          if (currentIdx !== -1 && latestIdx !== -1) {
            return currentIdx - latestIdx
          }
        }

        return 0
      })
      .catch((error) => {
        logger.warn('Failed to calculate versions behind:', error)
        return 0
      })
  }

  /**
   * Get the release date of a specific version
   */
  async function getReleaseDate(version?: string): Promise<Date | null> {
    const info = await getDeploymentInfo(version)
    return info?.releaseDate || null
  }

  /**
   * Get all available versions
   */
  async function getAvailableVersions(): Promise<DeploymentInfo[]> {
    return $fetch('/_skew/debug')
      .then((response) => {
        if (response && typeof response === 'object') {
          const deployments = (response as any).deployments || []
          return deployments.map((d: any) => ({
            id: d.id,
            timestamp: d.timestamp,
            releaseDate: d.timestamp ? new Date(d.timestamp) : undefined,
          }))
        }

        return []
      })
      .catch((error) => {
        logger.warn('Failed to get available versions:', error)
        return []
      })
  }

  /**
   * Update to a specific version (updates cookie and clears mismatch)
   */
  function updateVersion(version: string) {
    $skewProtection.updateVersion(version)
  }

  /**
   * Update to the latest version and reload
   */
  function updateAndReload() {
    if (newVersion.value) {
      $skewProtection.updateVersion(newVersion.value)
    }
    $skewProtection.reload()
  }

  /**
   * Reload the page
   */
  function reload() {
    $skewProtection.reload()
  }

  /**
   * Dismiss the version mismatch notification (without updating version)
   */
  function dismiss() {
    $skewProtection.dismiss()
  }

  /**
   * Register a callback for when current modules are invalidated
   * Returns an unsubscribe function
   */
  function onCurrentModulesInvalidated(callback: (payload: ModuleInvalidatedPayload) => void | Promise<void>) {
    const hook = nuxtApp.hooks.hook('skew-protection:module-invalidated', callback)

    // Cleanup on unmount
    onUnmounted(() => {
      // Remove the hook when component unmounts
      if (typeof hook === 'function') {
        hook()
      }
    })

    return hook
  }

  const runtimeConfig = useRuntimeConfig()

  return {
    // State
    isOutdated,
    newVersion,
    currentVersion: runtimeConfig.app.buildId,
    currentBuildId,
    versionMismatch,
    detectionReason,

    // Methods
    getDeploymentInfo,
    getVersionsBehind,
    getReleaseDate,
    getAvailableVersions,
    updateVersion,
    updateAndReload,
    reload,
    dismiss,
    onCurrentModulesInvalidated,
  }
}
