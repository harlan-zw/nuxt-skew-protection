import { useNuxtApp } from '#app'
import { computed } from 'vue'

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

export function useSkewProtection() {
  const { $skewProtection } = useNuxtApp()

  if (!$skewProtection) {
    throw new Error('useSkewProtection() can only be used in client-side code')
  }

  // Reactive state from the plugin
  const versionMismatch = computed(() => $skewProtection.versionMismatch.value)
  const versionCookie = computed(() => $skewProtection.versionCookie.value)
  const currentBuildId = computed(() => $skewProtection.currentBuildId)
  const wsConnected = computed(() => $skewProtection.wsConnected?.value || false)

  // Computed properties for easier access
  const isOutdated = computed(() => versionMismatch.value.detected)
  const newVersion = computed(() => versionMismatch.value.newVersion)
  const currentVersion = computed(() => versionMismatch.value.currentVersion || versionCookie.value)
  const detectionReason = computed(() => versionMismatch.value.reason)

  /**
   * Check if the current version is up to date
   */
  async function checkForUpdates() {
    return await $skewProtection.checkForUpdates()
  }

  /**
   * Get detailed version status from the API
   */
  async function getVersionStatus(): Promise<VersionInfo | null> {
    return await $skewProtection.checkVersionStatus()
  }

  /**
   * Get deployment information including release date
   */
  async function getDeploymentInfo(version?: string): Promise<DeploymentInfo | null> {
    try {
      const targetVersion = version || currentBuildId.value
      const response = await $fetch(`/_skew/debug`)

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
    }
    catch (error) {
      console.warn('[useSkewProtection] Failed to get deployment info:', error)
      return null
    }
  }

  /**
   * Calculate how many versions behind the current version is
   */
  async function getVersionsBehind(): Promise<number> {
    try {
      const response = await $fetch('/_skew/debug')

      if (response && typeof response === 'object') {
        const deployments = (response as any).deployments || []
        const currentIdx = deployments.findIndex((d: any) => d.id === currentVersion.value)
        const latestIdx = deployments.findIndex((d: any) => d.id === newVersion.value)

        if (currentIdx !== -1 && latestIdx !== -1) {
          return currentIdx - latestIdx
        }
      }

      return 0
    }
    catch (error) {
      console.warn('[useSkewProtection] Failed to calculate versions behind:', error)
      return 0
    }
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
    try {
      const response = await $fetch('/_skew/debug')

      if (response && typeof response === 'object') {
        const deployments = (response as any).deployments || []
        return deployments.map((d: any) => ({
          id: d.id,
          timestamp: d.timestamp,
          releaseDate: d.timestamp ? new Date(d.timestamp) : undefined,
        }))
      }

      return []
    }
    catch (error) {
      console.warn('[useSkewProtection] Failed to get available versions:', error)
      return []
    }
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
   * Connect to WebSocket (if enabled and not already connected)
   */
  function connectWebSocket() {
    if ($skewProtection.connectWebSocket) {
      $skewProtection.connectWebSocket()
    }
  }

  /**
   * Disconnect from WebSocket
   */
  function disconnectWebSocket() {
    if ($skewProtection.disconnectWebSocket) {
      $skewProtection.disconnectWebSocket()
    }
  }

  return {
    // State
    isOutdated,
    newVersion,
    currentVersion,
    currentBuildId,
    versionMismatch,
    detectionReason,
    wsConnected,

    // Methods
    checkForUpdates,
    getVersionStatus,
    getDeploymentInfo,
    getVersionsBehind,
    getReleaseDate,
    getAvailableVersions,
    updateVersion,
    updateAndReload,
    reload,
    dismiss,
    connectWebSocket,
    disconnectWebSocket,
  }
}
