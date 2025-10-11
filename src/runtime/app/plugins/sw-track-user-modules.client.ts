import { defineNuxtPlugin } from 'nuxt/app'
import { logger } from '../../shared/logger'
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
      logger.debug('[SW] Service Worker not supported in this browser')
      return
    }

    const { clientVersion, onAppOutdated } = useSkewProtection()
    logger.debug('[SW] Initializing service worker tracking')

    // Register service worker and sync already-loaded modules once ready
    const swRegistration = navigator.serviceWorker.register('/_nuxt-skew-sw.js')

    swRegistration.then((registration) => {
      logger.debug('[SW] Service worker registered successfully')

      // Wait for SW to be active and controlling
      const sw = registration.active || registration.installing || registration.waiting
      if (!sw) {
        logger.debug('[SW] No active/installing/waiting service worker found')
        return
      }

      // Send modules that loaded before SW could intercept them
      const alreadyLoadedModules = performance
        .getEntriesByType('resource')
        .filter(r => r.name.includes('/_nuxt/') && r.name.endsWith('.js'))
        .map(r => r.name)

      logger.debug(`[SW] Syncing ${alreadyLoadedModules.length} pre-loaded modules to service worker`)

      alreadyLoadedModules.forEach((url) => {
        logger.debug(`[SW] Sending module to SW: ${url}`)
        sw.postMessage({ type: 'ADD_MODULE', url })
      })
    }).catch((error) => {
      logger.debug('[SW] Service worker registration failed:', error)
    })

    /**
     * Get list of loaded modules from service worker
     */
    async function getLoadedModules(): Promise<string[]> {
      const registration = await swRegistration
      const sw = registration.active

      if (!sw) {
        logger.debug('[SW] No active service worker to get modules from')
        return []
      }

      logger.debug('[SW] Requesting loaded modules from service worker')

      return new Promise((resolve) => {
        let timeoutId: ReturnType<typeof setTimeout>

        const messageHandler = (event: MessageEvent) => {
          if (event.data.type === 'MODULES_LIST') {
            clearTimeout(timeoutId)
            navigator.serviceWorker.removeEventListener('message', messageHandler)
            logger.debug(`[SW] Received ${event.data.modules.length} loaded modules from SW`)
            resolve(event.data.modules)
          }
        }

        navigator.serviceWorker.addEventListener('message', messageHandler)
        sw.postMessage({ type: 'GET_MODULES' })

        // Timeout after 5 seconds
        timeoutId = setTimeout(() => {
          navigator.serviceWorker.removeEventListener('message', messageHandler)
          logger.debug('[SW] Timeout waiting for modules list from service worker')
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
        logger.debug('[SW] No deleted chunks to check')
        return
      }

      logger.debug(`[SW] Checking ${deletedChunks.length} deleted chunks against loaded modules`)

      const loadedModules = await getLoadedModules()
      if (loadedModules.length === 0) {
        logger.debug('[SW] No loaded modules to check against')
        return
      }

      const normalizedDeletedChunks = new Set(deletedChunks.map(normalizePath))
      const invalidatedModules = loadedModules.filter((module) => {
        const normalizedModule = normalizePath(module)
        return normalizedDeletedChunks.has(normalizedModule)
      })

      logger.debug(`[SW] Found ${invalidatedModules.length} invalidated modules`)

      if (invalidatedModules.length > 0) {
        logger.debug('[SW] Triggering chunks-outdated hook with:', {
          deletedChunks,
          invalidatedModules,
          passedReleases,
        })
        await nuxtApp.hooks.callHook('skew-protection:chunks-outdated', {
          deletedChunks,
          invalidatedModules,
          passedReleases,
        })
      }
    }

    // Listen for app:manifest:update to check for deleted chunks
    onAppOutdated(async (_manifest) => {
      logger.debug('[SW] App outdated event received')

      const versions = _manifest?.skewProtection?.versions
      if (!versions) {
        logger.debug('[SW] No version information in manifest')
        return
      }
      const newVersionId = _manifest.id
      logger.debug(`[SW] Checking version transition: ${clientVersion} → ${newVersionId}`)

      // Sort versions by timestamp to find the range
      const sortedVersions = Object.entries(versions)
        .map(([id, data]) => ({ id, timestamp: new Date(data.timestamp).getTime() }))
        .sort((a, b) => a.timestamp - b.timestamp)

      const currentIdx = sortedVersions.findIndex(v => v.id === clientVersion)
      const newIdx = sortedVersions.findIndex(v => v.id === newVersionId)

      logger.debug(`[SW] Version indices - current: ${currentIdx}, new: ${newIdx}`)

      // Collect deleted chunks and release IDs from all versions between current and new (inclusive of new)
      const allDeletedChunks: string[] = []
      const passedReleases: string[] = []

      // If current version is missing (cleaned up or never tracked), check ALL versions
      if (currentIdx === -1) {
        logger.debug('[SW] Current version not found in manifest, checking all versions')
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
        logger.debug('[SW] New version not in manifest, checking all versions after current')
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
        logger.debug(`[SW] Checking versions between current (${currentIdx}) and new (${newIdx})`)
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

      logger.debug(`[SW] Collected ${allDeletedChunks.length} deleted chunks across ${passedReleases.length} releases`)

      if (allDeletedChunks.length > 0) {
        // Small delay to ensure SW has received module list
        await new Promise(resolve => setTimeout(resolve, 100))
        await checkDeletedChunks(allDeletedChunks, passedReleases)
      }

      // Reset loaded modules in service worker on version change
      // TODO: Disabled for testing - may not be needed if we track properly
      logger.debug('[SW] Resetting modules in service worker')
      swRegistration.then(reg => reg.active?.postMessage({ type: 'RESET_MODULES' }))
    })
  },
})
