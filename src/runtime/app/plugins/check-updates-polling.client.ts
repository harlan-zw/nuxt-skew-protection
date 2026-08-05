import { useIntervalFn } from '@vueuse/core'
import { defineNuxtPlugin, useRuntimeConfig } from 'nuxt/app'
import { useSkewProtection } from '../composables/useSkewProtection'

export default defineNuxtPlugin({
  name: 'skew-protection:external-polling',
  setup() {
    if (import.meta.prerender)
      return

    const config = useRuntimeConfig().public.skewProtection
    const skewProtection = useSkewProtection()
    useIntervalFn(
      () => skewProtection.checkForUpdates(),
      config.updateInterval || 60 * 60 * 1000,
      { immediate: true, immediateCallback: true },
    )
  },
})
