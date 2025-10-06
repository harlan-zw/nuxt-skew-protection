import type { NuxtAppManifestMeta } from '#app'
import { useRuntimeConfig } from '#app'
import { useWindowFocus } from '@vueuse/core'
import { defineNuxtPlugin } from 'nuxt/app'
import { computed, ref, watch } from 'vue'
import { useSkewProtection } from '../composables/useSkewProtection'

export default defineNuxtPlugin({
  name: 'skew-protection:root',
  setup(nuxtApp) {
    const runtimeConfig = useRuntimeConfig()
    const skewProtection = useSkewProtection()
    // static
    const currentVersion = runtimeConfig.app.buildId || skewProtection.cookie.value
    // dynamic
    const latestVersion = ref(currentVersion)
    const manifest = ref(<NuxtAppManifestMeta | null>null)

    const isOutdated = computed(() => currentVersion !== latestVersion.value)

    if (import.meta.client) {
      nuxtApp.hooks.hook('app:manifest:update', (_manifest) => {
        if (_manifest) {
          manifest.value = _manifest
          const newVersion = _manifest.id
          if (newVersion && newVersion !== latestVersion.value) {
            latestVersion.value = newVersion
          }
        }
      })

      const focused = useWindowFocus()
      watch(focused, () => {
        // if we're switching focus then we can check for a hard reload
        if (isOutdated.value) {
          // reloadNuxtApp()
        }
      })
    }

    // Expose helpers via provide
    return {
      provide: {
        skewProtection: {
          manifest,
          currentVersion,
          isOutdated,
        },
      },
    }
  },
})
