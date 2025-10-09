import type { NuxtAppManifestMeta } from 'nuxt/app'
import type { Ref } from 'vue'
import type { ChunksOutdatedPayload } from '../../types'
// @ts-expect-error virtual file
import { buildAssetsURL } from '#internal/nuxt/paths'
import { useNuxtApp } from 'nuxt/app'
import { onUnmounted } from 'vue'

export function useSkewProtection() {
  const nuxtApp = useNuxtApp()

  const skewProtection = nuxtApp.$skewProtection as {
    manifest: Ref<NuxtAppManifestMeta | null>
    currentVersion: string | undefined
    isOutdated: Ref<boolean>
    cookie: Ref<string | undefined>
  }
  // throw error if not available
  if (!skewProtection) {
    console.error('useSkewProtection() is called but skewProtection is not available. Make sure the "skew-protection:root" plugin is registered and runs before this.')
    throw new Error('skewProtection is not available')
  }

  async function checkForUpdates() {
    const meta = await $fetch<NuxtAppManifestMeta>(`${buildAssetsURL('builds/latest.json')}?${Date.now()}`).catch(() => {
      return null
    })
    if (meta && meta?.id !== skewProtection.currentVersion) {
      // will propegate to the app via the hook above
      await nuxtApp.hooks.callHook('app:manifest:update', meta)
    }
  }

  /**
   * Register a callback for when chunks become outdated
   * Returns an unsubscribe function
   */
  function onCurrentChunksOutdated(callback: (payload: ChunksOutdatedPayload) => void | Promise<void>) {
    const hook = nuxtApp.hooks.hook('skew-protection:chunks-outdated', callback)

    // Cleanup on unmount
    onUnmounted(() => {
      // Remove the hook when component unmounts
      if (typeof hook === 'function') {
        hook()
      }
    })

    return hook
  }

  function onAppOutdated(callback: (manifest?: NuxtAppManifestMeta) => void | Promise<void>) {
    // use nuxts own hook
    const hook = nuxtApp.hooks.hook('app:manifest:update', callback)

    // Cleanup on unmount
    onUnmounted(() => {
      // Remove the hook when component unmounts
      if (typeof hook === 'function') {
        hook()
      }
    })

    return hook
  }

  return {
    ...skewProtection,
    onCurrentChunksOutdated,
    onAppOutdated,
    checkForUpdates,
    async simulateUpdate() {
      if (!import.meta.dev) {
        return
      }
      await nuxtApp.hooks.callHook('skew-protection:chunks-outdated', {
        deletedChunks: [],
        invalidatedModules: [],
        passedReleases: [],
      })
    },
  }
}
