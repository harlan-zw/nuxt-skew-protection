import type { NuxtApp } from 'nuxt/app'
import { defineNuxtPlugin } from 'nuxt/app'
import { useSkewProtectionCookie } from '../composables/useSkewProtectionCookie'

export default defineNuxtPlugin({
  name: 'skew-protection:service-worker',
  setup(nuxtApp: NuxtApp) {
    if (!('serviceWorker' in navigator)) {
      return
    }

    const versionCookie = useSkewProtectionCookie()

    // Register service worker
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('[skew-protection] Service Worker registration failed:', error)
    })

    // Helper function to get loaded modules from service worker
    function getLoadedModules(): Promise<string[]> {
      return new Promise((resolve) => {
        const messageHandler = (event: MessageEvent) => {
          if (event.data.type === 'MODULES_LIST') {
            navigator.serviceWorker.removeEventListener('message', messageHandler)
            resolve(event.data.modules)
          }
        }

        navigator.serviceWorker.addEventListener('message', messageHandler)
        navigator.serviceWorker.controller?.postMessage({ type: 'GET_MODULES' })

        // Timeout after 5 seconds
        setTimeout(() => {
          navigator.serviceWorker.removeEventListener('message', messageHandler)
          resolve([])
        }, 5000)
      })
    }

    // Normalize path to match format: _nuxt/chunk.js
    function normalizePath(pathOrUrl: string): string {
      try {
        const url = new URL(pathOrUrl)
        // Remove leading slash from pathname and return
        return url.pathname.replace(/^\//, '')
      }
      catch {
        // Already a path, just remove leading slash if present
        return pathOrUrl.replace(/^\//, '')
      }
    }

    // Check if deleted chunks intersect with loaded modules
    async function checkDeletedChunks(deletedChunks: string[]) {
      console.log('[skew-protection] Checking for deleted chunks:', deletedChunks)
      if (!deletedChunks || deletedChunks.length === 0) {
        return
      }

      const loadedModules = await getLoadedModules()
      console.log('[skew-protection] Loaded modules:', loadedModules)
      if (!loadedModules || loadedModules.length === 0) {
        return
      }

      // Normalize all deleted chunks to consistent format
      const normalizedDeletedChunks = new Set(deletedChunks.map(normalizePath))
      console.log('[skew-protection] Normalized deleted chunks:', Array.from(normalizedDeletedChunks))

      // Check if any loaded module was deleted
      const invalidatedModules = loadedModules.filter((module) => {
        const normalizedModule = normalizePath(module)
        return normalizedDeletedChunks.has(normalizedModule)
      })

      console.log('[skew-protection] Invalidated modules:', invalidatedModules)

      if (invalidatedModules.length > 0) {
        console.warn('[skew-protection] Module invalidated - deleted chunks detected:', invalidatedModules)

        // Call the Nuxt hook
        await nuxtApp.hooks.callHook('skew-protection:module-invalidated', {
          deletedChunks,
          invalidatedModules,
        })
      }
    }

    // Listen for app:manifest:update to check for deleted chunks
    nuxtApp.hook('app:manifest:update', async (manifest) => {
      console.log('[skew-protection] Manifest updated:', manifest)
      // Check if the manifest contains skewProtection data with versions
      if (manifest?.skewProtection?.versions) {
        const versions = manifest.skewProtection.versions
        const newVersionId = manifest.id

        // Get current version from cookie
        const currentVersionId = versionCookie.value

        console.log('[skew-protection] Current version:', currentVersionId, 'New version:', newVersionId)

        if (!currentVersionId || currentVersionId === newVersionId) {
          return
        }

        // Reset loaded modules in service worker on version change
        navigator.serviceWorker.controller?.postMessage({ type: 'RESET_MODULES' })

        // Collect all deleted chunks between current version and new version
        const allDeletedChunks: string[] = []

        // Sort versions by timestamp to find the range
        const sortedVersions = Object.entries(versions)
          .map(([id, data]) => ({ id, timestamp: new Date(data.timestamp).getTime() }))
          .sort((a, b) => a.timestamp - b.timestamp)

        const currentIdx = sortedVersions.findIndex(v => v.id === currentVersionId)
        const newIdx = sortedVersions.findIndex(v => v.id === newVersionId)

        if (currentIdx === -1 || newIdx === -1) {
          console.warn('[skew-protection] Could not find version indices')
          return
        }

        // Collect deleted chunks from all versions between current and new (inclusive of new)
        for (let i = currentIdx + 1; i <= newIdx; i++) {
          const version = sortedVersions[i]
          if (version) {
            const versionData = versions[version.id]
            if (versionData?.deletedChunks) {
              allDeletedChunks.push(...versionData.deletedChunks)
            }
          }
        }

        console.log('[skew-protection] All deleted chunks between versions:', allDeletedChunks)

        if (allDeletedChunks.length > 0) {
          await checkDeletedChunks(allDeletedChunks)
        }
      }
    })

    // Listen for messages from service worker
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data.type === 'MODULE_LOADED') {
        console.log('[skew-protection] New module loaded:', event.data.url)
      }
    })

    // Expose helpers via provide
    return {
      provide: {
        skewServiceWorker: {
          getLoadedModules,
        },
      },
    }
  },
})
