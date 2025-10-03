export default defineNuxtConfig({
  modules: [
    '../../../../src/module.ts', // Use our local skew protection module
  ],

  skewProtection: {
    debug: true,
    retentionDays: 7,
    maxNumberOfVersions: 10,
    notificationStrategy: 'modal',
    checkOutdatedBuildInterval: 30000,
    // Enable Durable Objects for real-time updates on Cloudflare
    durableObjects: true,
  },

  // Cloudflare Workers configuration
  nitro: {
    preset: 'cloudflare',
    // Enable experimental features for Cloudflare
    experimental: {
      wasm: true,
    },
  },

  // Ensure unique build ID for each deployment
  app: {
    buildId: process.env.NUXT_DEPLOYMENT_ID || `dpl-${Date.now().toString(36)}`,
  },

  // Runtime config for client access
  runtimeConfig: {
    public: {
      deploymentId: process.env.NUXT_DEPLOYMENT_ID,
      buildId: process.env.NUXT_BUILD_ID,
    },
  },

  compatibilityDate: '2025-03-13',
})
