export default defineNuxtConfig({
  modules: ['../src/module'],
  experimental: {
    appManifest: true,
  },
  skewProtection: {
    storage: {
      driver: 'memory', // Use memory storage for playground testing
    },
    checkOutdatedBuildInterval: 10000, // 10 seconds for faster testing
    retentionDays: 1, // Short retention for testing
    debug: true,
    notificationStrategy: 'modal',
    // Uncomment to enable WebSocket for real-time updates
    // enableWebSocket: true,
  },
  devtools: { enabled: true },
})
