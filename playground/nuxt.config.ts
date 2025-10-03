export default defineNuxtConfig({
  modules: ['../src/module'],
  experimental: {
    appManifest: true,
    checkOutdatedBuildInterval: 30 * 1000, // this is ms
  },
  skewProtection: {
    checkForUpdateStrategy: 'ws',
    retentionDays: 1, // Short retention for testing
    debug: true,
  },
  nitro: {
    experimental: {
      websocket: true,
    },
  },
  devtools: { enabled: true },
})
