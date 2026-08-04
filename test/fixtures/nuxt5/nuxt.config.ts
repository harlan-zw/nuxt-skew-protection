import NuxtSkewProtection from 'nuxt-skew-protection'

export default defineNuxtConfig({
  modules: [
    NuxtSkewProtection,
  ],

  compatibilityDate: '2026-06-10',

  devtools: {
    enabled: false,
  },

  skewProtection: {
    bundleAssets: false,
    multiTab: false,
    reloadStrategy: false,
    updateStrategy: 'polling',
  },

  runtimeConfig: {
    app: {
      buildId: 'nuxt5-fixture-v1',
    },
  },
})
