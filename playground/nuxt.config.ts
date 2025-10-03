export default defineNuxtConfig({
  modules: ['../src/module'],
  experimental: {
    appManifest: true,
  },
  skewProtection: {
    checkOutdatedBuildInterval: 10000, // 10 seconds for faster testing
    retentionDays: 1, // Short retention for testing
    debug: true,
    // Uncomment to enable WebSocket for real-time updates
    // enableWebSocket: true,
  },
  devtools: { enabled: true },
})
