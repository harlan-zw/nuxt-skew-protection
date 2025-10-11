import type { CookieOptions } from 'nuxt/app'
import { defineNuxtPlugin, useCookie, useRuntimeConfig, useState } from 'nuxt/app'
import { init } from '../../shared/logger'

/**
 * Initialize buildId state for SSR->client hydration
 * Also sets cookie client-side for static/prerendered scenarios
 */
export default defineNuxtPlugin({
  name: 'skew-protection:init-build-id',
  enforce: 'pre',
  setup() {
    init()
    const runtimeConfig = useRuntimeConfig()
    const buildId = runtimeConfig.app.buildId
    const cookieConfig = runtimeConfig.public.skewProtection.cookie

    // Initialize state (hydrates from server in static/prerendered)
    const buildIdState = useState('skew-protection:build-id', () => buildId)
    const { name, ...cookieOpts } = cookieConfig
    const cookie = useCookie(name, {
      ...(cookieOpts as CookieOptions),
      readonly: false,
    })
    // Set cookie client-side if not already set
    if (import.meta.client && cookieConfig) {
      if (!cookie.value && buildIdState.value) {
        cookie.value = buildIdState.value
      }
    }

    return {
      provide: {
        skewProtectionBuildId: buildIdState,
        skewProtectionCookie: cookie,
      },
    }
  },
})
