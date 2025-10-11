import { defineNuxtPlugin } from 'nuxt/app'
import { useSkewProtection } from '../composables/useSkewProtection'

/**
 * Normalize path to match format: _nuxt/chunk.js
 * Handles both full URLs and relative paths
 */
function normalizePath(pathOrUrl: string): string {
  try {
    const url = new URL(pathOrUrl)
    return url.pathname.replace(/^\//, '')
  }
  catch {
    return pathOrUrl.replace(/^\//, '')
  }
}

export default defineNuxtPlugin({
  name: 'skew-protection:service-worker',
  setup(nuxtApp) {
    if (!('serviceWorker' in navigator)) {
      return
    }
    const { clientVersion, onAppOutdated } = useSkewProtection()

    // Register service worker and sync already-loaded modules once ready
    const swRegistration = navigator.serviceWorker.register('/_nuxt-skew-sw.js')

    swRegistration.then((registration) => {
      // Wait for SW to be active and controlling
      const sw = registration.active || registration.installing || registration.waiting
      if (!sw)
        return

      // Send modules that loaded before SW could intercept them
      const alreadyLoadedModules = performance
        .getEntriesByType('resource')
        .filter(r => r.name.includes('/_nuxt/') && r.name.endsWith('.js'))
        .map(r => r.name)

      alreadyLoadedModules.forEach((url) => {
        sw.postMessage({ type: 'ADD_MODULE', url })
      })
    })

    /**
     * Get list of loaded modules from service worker
     */
    async function getLoadedModules(): Promise<string[]> {
      const registration = await swRegistration
      const sw = registration.active

      if (!sw) {
        return []
      }

      return new Promise((resolve) => {
        let timeoutId: ReturnType<typeof setTimeout>

        const messageHandler = (event: MessageEvent) => {
          if (event.data.type === 'MODULES_LIST') {
            clearTimeout(timeoutId)
            navigator.serviceWorker.removeEventListener('message', messageHandler)
            resolve(event.data.modules)
          }
        }

        navigator.serviceWorker.addEventListener('message', messageHandler)
        sw.postMessage({ type: 'GET_MODULES' })

        // Timeout after 5 seconds
        timeoutId = setTimeout(() => {
          navigator.serviceWorker.removeEventListener('message', messageHandler)
          resolve([])
        }, 5000)
      })
    }

    /**
     * Check if any deleted chunks intersect with currently loaded modules
     * and trigger the chunks-outdated hook if so
     */
    async function checkDeletedChunks(deletedChunks: string[], passedReleases: string[]) {
      if (deletedChunks.length === 0) {
        return
      }

      const loadedModules = await getLoadedModules()
      if (loadedModules.length === 0) {
        return
      }

      const normalizedDeletedChunks = new Set(deletedChunks.map(normalizePath))
      const invalidatedModules = loadedModules.filter((module) => {
        const normalizedModule = normalizePath(module)
        return normalizedDeletedChunks.has(normalizedModule)
      })

      if (invalidatedModules.length > 0) {
        await nuxtApp.hooks.callHook('skew-protection:chunks-outdated', {
          deletedChunks,
          invalidatedModules,
          passedReleases,
        })
      }
    }

    // Listen for app:manifest:update to check for deleted chunks
    onAppOutdated(async (_manifest) => {
      const versions = _manifest?.skewProtection?.versions
      if (!versions) {
        return
      }
      const newVersionId = _manifest.id
      // Sort versions by timestamp to find the range
      const sortedVersions = Object.entries(versions)
        .map(([id, data]) => ({ id, timestamp: new Date(data.timestamp).getTime() }))
        .sort((a, b) => a.timestamp - b.timestamp)

      const currentIdx = sortedVersions.findIndex(v => v.id === clientVersion)
      const newIdx = sortedVersions.findIndex(v => v.id === newVersionId)

      // Collect deleted chunks and release IDs from all versions between current and new (inclusive of new)
      const allDeletedChunks: string[] = []
      const passedReleases: string[] = []

      // If current version is missing (cleaned up or never tracked), check ALL versions
      if (currentIdx === -1) {
        for (const version of sortedVersions) {
          passedReleases.push(version.id)
          const versionData = versions[version.id]
          if (versionData?.deletedChunks) {
            allDeletedChunks.push(...versionData.deletedChunks)
          }
        }
      }
      // If new version is not in manifest, it's newer than all tracked versions - check all versions from current onwards
      else if (newIdx === -1) {
        for (let i = currentIdx + 1; i < sortedVersions.length; i++) {
          const version = sortedVersions[i]
          if (version) {
            passedReleases.push(version.id)
            const versionData = versions[version.id]
            if (versionData?.deletedChunks) {
              allDeletedChunks.push(...versionData.deletedChunks)
            }
          }
        }
      }
      // Otherwise only check versions between current and new
      else {
        for (let i = currentIdx + 1; i <= newIdx; i++) {
          const version = sortedVersions[i]
          if (version) {
            passedReleases.push(version.id)
            const versionData = versions[version.id]
            if (versionData?.deletedChunks) {
              allDeletedChunks.push(...versionData.deletedChunks)
            }
          }
        }
      }

      if (allDeletedChunks.length > 0) {
        // Small delay to ensure SW has received module list
        await new Promise(resolve => setTimeout(resolve, 100))
        await checkDeletedChunks(allDeletedChunks, passedReleases)
      }

      // Reset loaded modules in service worker on version change
      // TODO: Disabled for testing - may not be needed if we track properly
      swRegistration.then(reg => reg.active?.postMessage({ type: 'RESET_MODULES' }))
    })
  },
})
