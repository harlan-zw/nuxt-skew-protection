import type { NuxtAppManifestMeta } from '#app'
import type { Ref } from 'vue'
import type { ChunksOutdatedPayload } from '../../types'
import { useCookie, useNuxtApp, useRuntimeConfig } from '#app'
// @ts-expect-error virtual file
import { buildAssetsURL } from '#internal/nuxt/paths'
import { onUnmounted } from 'vue'
import { useRuntimeConfigSkewProtection } from './useRuntimeConfigSkewProtection'

export function useSkewProtection() {
  const nuxtApp = useNuxtApp()
  const config = useRuntimeConfig()
  const { cookie: cookieConfig } = useRuntimeConfigSkewProtection()
  const { name: cookieName, ...cookieOptions } = cookieConfig

  const cookie = useCookie(cookieName, {
    default: () => config.app.buildId,
    ...cookieOptions,
  })

  const skewProtection = nuxtApp.$skewProtection as {
    manifest: Ref<NuxtAppManifestMeta | null>
    currentVersion: string | undefined
    isOutdated: Ref<boolean>
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
  function onChunksOutdated(callback: (payload: ChunksOutdatedPayload) => void | Promise<void>) {
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

  return {
    ...skewProtection,
    cookie,
    onChunksOutdated,
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
