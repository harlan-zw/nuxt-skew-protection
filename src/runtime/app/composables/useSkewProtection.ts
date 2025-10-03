import type { NuxtAppManifestMeta } from '#app'
import type { Ref } from 'vue'
import type { ModuleInvalidatedPayload } from '../../types'
import { useNuxtApp } from '#app'
// @ts-expect-error virtual file
import { buildAssetsURL } from '#internal/nuxt/paths'
import { onUnmounted } from 'vue'

export function useSkewProtection() {
  const nuxtApp = useNuxtApp()

  const skewProtection = nuxtApp.$skewProtection as {
    manifest: Ref<NuxtAppManifestMeta | null>
    currentVersion: string | undefined
    isOutdated: Ref<boolean>
  }
  async function checkForUpdates() {
    const meta = await $fetch(`${buildAssetsURL('builds/latest.json')}?${Date.now()}`)
    if (meta.id !== skewProtection.currentVersion) {
      // will propegate to the app via the hook above
      await nuxtApp.hooks.callHook('app:manifest:update', meta)
    }
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

  return {
    ...skewProtection,
    onCurrentModulesInvalidated,
    checkForUpdates,
  }
}
