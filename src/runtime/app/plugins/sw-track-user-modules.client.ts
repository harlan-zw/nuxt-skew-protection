import { defineNuxtPlugin } from '#app'
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
  dependsOn: [
    'skew-protection:root',
  ],
  setup(nuxtApp) {
    if (!('serviceWorker' in navigator)) {
      return
    }
    const skew = useSkewProtection()
    const versionCookie = skew.cookie

    // Register service worker
    navigator.serviceWorker.register('/_skew/sw.js')

    /**
     * Get list of loaded modules from service worker
     */
    function getLoadedModules(): Promise<string[]> {
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
        navigator.serviceWorker.controller?.postMessage({ type: 'GET_MODULES' })

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
    skew.onAppOutdated(async (_manifest) => {
      const versions = _manifest?.skewProtection?.versions
      if (!versions) {
        return
      }

      const newVersionId = _manifest.id
      const currentVersionId = versionCookie.value

      if (!currentVersionId || currentVersionId === newVersionId) {
        return
      }

      // Reset loaded modules in service worker on version change
      navigator.serviceWorker.controller?.postMessage({ type: 'RESET_MODULES' })

      // Sort versions by timestamp to find the range
      const sortedVersions = Object.entries(versions)
        .map(([id, data]) => ({ id, timestamp: new Date(data.timestamp).getTime() }))
        .sort((a, b) => a.timestamp - b.timestamp)

      const currentIdx = sortedVersions.findIndex(v => v.id === currentVersionId)
      const newIdx = sortedVersions.findIndex(v => v.id === newVersionId)

      if (currentIdx === -1 || newIdx === -1) {
        return
      }

      // Collect deleted chunks and release IDs from all versions between current and new (inclusive of new)
      const allDeletedChunks: string[] = []
      const passedReleases: string[] = []

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

      if (allDeletedChunks.length > 0) {
        await checkDeletedChunks(allDeletedChunks, passedReleases)
      }
    })

    return {
      provide: {
        skewServiceWorker: {
          getLoadedModules,
        },
      },
    }
  },
})
