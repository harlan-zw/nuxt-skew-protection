import type { NuxtAppManifestMeta } from 'nuxt/app'
import type { ChunksOutdatedPayload } from '../../types'
// @ts-expect-error virtual file
import { buildAssetsURL } from '#internal/nuxt/paths'
import { useNuxtApp, useRuntimeConfig } from 'nuxt/app'
import { computed, onUnmounted, ref } from 'vue'

export async function checkForUpdates() {
  const nuxtApp = useNuxtApp()
  const runtimeConfig = useRuntimeConfig()
  const clientVersion = runtimeConfig.app.buildId
  const meta = await $fetch<NuxtAppManifestMeta>(`${buildAssetsURL('builds/latest.json')}?${Date.now()}`).catch(() => {
    return null
  })
  if (meta && meta?.id !== clientVersion) {
    // will propegate to the app via the hook above
    await nuxtApp.hooks.callHook('app:manifest:update', meta)
  }
}

export function useSkewProtection() {
  const nuxtApp = useNuxtApp()
  const runtimeConfig = useRuntimeConfig()
  const clientVersion = runtimeConfig.app.buildId
  const manifest = ref<NuxtAppManifestMeta | undefined>()

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
    const hook = nuxtApp.hooks.hook('app:manifest:update', (_manifest) => {
      manifest.value = _manifest
      callback(_manifest)
    })

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
    manifest,
    clientVersion,
    isOutdated: computed(() => manifest.value && clientVersion !== manifest.value.id),
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
