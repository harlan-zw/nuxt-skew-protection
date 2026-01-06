export default defineNuxtConfig({
  modules: ['@nuxt/ui', 'nuxt-auth-utils', '../src/module'],
  css: ['~/assets/css/main.css'],
  experimental: {
    appManifest: true,
    checkOutdatedBuildInterval: 30 * 1000, // this is ms
  },
  skewProtection: {
    updateStrategy: 'ws',
    retentionDays: 1, // Short retention for testing
    connectionTracking: true,
    routeTracking: true,
    ipTracking: true,
    debug: true,
  },
  nitro: {
    experimental: {
      websocket: true,
    },
  },
  devtools: { enabled: true },
})
