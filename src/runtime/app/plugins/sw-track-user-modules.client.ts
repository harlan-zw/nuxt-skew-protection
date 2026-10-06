import { defineNuxtPlugin, useRuntimeConfig } from 'nuxt/app'
// @ts-expect-error virtual file
import { buildAssetsURL } from '#internal/nuxt/paths'
import { logger } from '../../shared/logger'
import { useRuntimeConfigSkewProtection } from '../composables/useRuntimeConfigSkewProtection'
import { useSkewProtection } from '../composables/useSkewProtection'

/**
 * Normalize path to match format: _nuxt/chunk.js
 * Handles both full URLs and relative paths
 */
const RE_LEADING_SLASH = /^\//

function normalizePath(pathOrUrl: string): string {
  try {
    const url = new URL(pathOrUrl)
    return url.pathname.replace(RE_LEADING_SLASH, '')
  }
  catch {
    return pathOrUrl.replace(RE_LEADING_SLASH, '')
  }
}

function parseSkewFile(value: unknown): Record<string, string[]> {
  const deletedChunks = typeof value === 'object' && value !== null && 'deletedChunks' in value
    ? value.deletedChunks
    : undefined
  if (
    typeof deletedChunks !== 'object'
    || deletedChunks === null
    || Array.isArray(deletedChunks)
    || !Object.values(deletedChunks).every(chunks => Array.isArray(chunks) && chunks.every(chunk => typeof chunk === 'string'))
  ) {
    throw new Error('Invalid skew file')
  }
  return deletedChunks as Record<string, string[]>
}

export default defineNuxtPlugin({
  name: 'skew-protection:service-worker',
  async setup(nuxtApp) {
    if (import.meta.prerender)
      return

    if (!('serviceWorker' in navigator)) {
      logger.debug('[SW] Service Worker not supported in this browser')
      return
    }

    const appUrl = new URL(useRuntimeConfig().app.baseURL, window.location.origin)
    const serviceWorkerUrl = new URL('_nuxt-skew-sw.js', appUrl)
    const inspection = await navigator.serviceWorker.getRegistration(appUrl.href)
      .then(registration => ({ _tag: 'Ok' as const, registration }))
      .catch((error: unknown) => ({ _tag: 'Err' as const, error }))
    if (inspection._tag === 'Err') {
      logger.warn('[SW] Could not inspect service workers. Chunk tracking is disabled:', inspection.error)
      return
    }
    const registration = inspection.registration
    const existingWorker = registration?.active || registration?.installing || registration?.waiting
    if (existingWorker && new URL(existingWorker.scriptURL).pathname !== serviceWorkerUrl.pathname) {
      logger.debug('[SW] Keeping the existing service worker. Chunk tracking is disabled.')
      return
    }

    const { assetRecovery } = useRuntimeConfigSkewProtection()
    const { clientVersion, onAppOutdated } = useSkewProtection()
    logger.debug('[SW] Initializing service worker tracking')

    // Register service worker and sync already-loaded modules once ready
    if (assetRecovery._tag === 'cloudflare') {
      serviceWorkerUrl.searchParams.set('buildAssetsPath', assetRecovery.buildAssetsPath)
      serviceWorkerUrl.searchParams.set('recoveryPath', assetRecovery.recoveryPath)
    }
    const swRegistration = navigator.serviceWorker.register(serviceWorkerUrl.href)

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
    let activeSkewVersionId: string | undefined

    async function checkDeletedChunks(deletedChunks: string[], passedReleases: string[], versionId: string) {
      if (deletedChunks.length === 0) {
        logger.debug('[SW] No deleted chunks to check')
        return
      }

      logger.debug(`[SW] Checking ${deletedChunks.length} deleted chunks against loaded modules`)

      const loadedModules = await getLoadedModules()
      if (activeSkewVersionId !== versionId)
        return
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
        await nuxtApp.hooks.callHook('skew:chunks-outdated', {
          deletedChunks,
          invalidatedModules,
          passedReleases,
        })
      }
    }

    const checkedSkewVersions = new Set<string>()

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

      // Collect release IDs from all versions between current and new (inclusive of new)
      const passedReleases: string[] = []

      // If current version is missing (cleaned up or never tracked), check ALL versions
      if (currentIdx === -1) {
        logger.debug('[SW] Current version not found in manifest, checking all versions')
        passedReleases.push(...sortedVersions.map(v => v.id))
      }
      // If new version is not in manifest, it's newer than all tracked versions - check all versions from current onwards
      else if (newIdx === -1) {
        logger.debug('[SW] New version not in manifest, checking all versions after current')
        passedReleases.push(...sortedVersions.slice(currentIdx + 1).map(v => v.id))
      }
      // Otherwise only check versions between current and new
      else {
        logger.debug(`[SW] Checking versions between current (${currentIdx}) and new (${newIdx})`)
        passedReleases.push(...sortedVersions.slice(currentIdx + 1, newIdx + 1).map(v => v.id))
      }

      if (checkedSkewVersions.has(newVersionId))
        return
      activeSkewVersionId = newVersionId
      if (passedReleases.length === 0)
        return
      checkedSkewVersions.add(newVersionId)

      async function checkChunks(deletedChunksByVersion: Record<string, string[]>) {
        const allDeletedChunks = passedReleases.flatMap(id => deletedChunksByVersion[id] || [])
        logger.debug(`[SW] Collected ${allDeletedChunks.length} deleted chunks across ${passedReleases.length} releases`)
        if (allDeletedChunks.length === 0)
          return

        // Small delay to ensure SW has received module list
        await new Promise(resolve => setTimeout(resolve, 100))
        if (activeSkewVersionId !== newVersionId)
          return
        await checkDeletedChunks(allDeletedChunks, passedReleases, newVersionId)
      }

      // Older deployments include deleted chunks in latest.json, including rollback targets.
      const legacyVersions = versions as Record<string, { timestamp: string, deletedChunks?: string[] }>
      if (passedReleases.every(id => Array.isArray(legacyVersions[id]?.deletedChunks))) {
        await checkChunks(Object.fromEntries(passedReleases.map(id => [id, legacyVersions[id]!.deletedChunks!])))
        return
      }

      // latest.json carries only timestamps in new builds. Its skew file may arrive later.
      async function checkSkewFile(attempt: number): Promise<void> {
        if (activeSkewVersionId !== newVersionId)
          return
        const deletedChunksByVersion = await ($fetch(buildAssetsURL(`builds/skew/${newVersionId}.json`)) as Promise<unknown>)
          .then(parseSkewFile)
          .catch((error: unknown) => {
            if (activeSkewVersionId !== newVersionId)
              return undefined
            const delay = Math.min(5000 * 2 ** attempt, 300000)
            logger.warn(`[SW] Could not fetch deleted chunks for ${newVersionId}; retrying in ${delay}ms:`, error)
            setTimeout(() => {
              void checkSkewFile(attempt + 1).catch(error => logger.error('[SW] Chunk check failed:', error))
            }, delay)
            return undefined
          })
        if (deletedChunksByVersion && activeSkewVersionId === newVersionId)
          await checkChunks(deletedChunksByVersion)
      }

      await checkSkewFile(0)
    })
  },
})
