const reloadStrategy = process.env.SKEW_RELOAD_STRATEGY === 'false'
  ? false
  : 'prompt'

export default defineNuxtConfig({
  modules: ['@nuxtjs/robots', '../../../src/module'],
  compatibilityDate: '2024-11-01',
  skewProtection: {
    storage: {
      driver: 'fs',
      base: '.skew-storage',
    },
    bundleAssets: false,
    reloadStrategy,
    multiTab: reloadStrategy !== false,
  },
})
