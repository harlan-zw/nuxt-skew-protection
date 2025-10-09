import type { NuxtAppManifestMeta } from 'nuxt/app'
import { defineNuxtPlugin, useCookie, useRuntimeConfig } from 'nuxt/app'
import { computed, ref } from 'vue'
import { useRuntimeConfigSkewProtection } from '../composables/useRuntimeConfigSkewProtection'

export default defineNuxtPlugin({
  name: 'skew-protection:root',
  enforce: 'pre',
  setup(nuxtApp) {
    const runtimeConfig = useRuntimeConfig()
    const { cookie: cookieConfig } = useRuntimeConfigSkewProtection()
    const { name: cookieName, ...cookieOptions } = cookieConfig

    const cookie = useCookie(cookieName, {
      default: () => runtimeConfig.app.buildId,
      ...cookieOptions,
    })

    // static
    const currentVersion = runtimeConfig.app.buildId || cookie.value
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
    }

    // Expose helpers via provide
    return {
      provide: {
        skewProtection: {
          manifest,
          currentVersion,
          isOutdated,
          cookie,
        },
      },
    }
  },
})
