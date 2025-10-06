export default defineNuxtConfig({
  modules: [
    '../../../../src/module.ts', // Use our local skew protection module
  ],

  skewProtection: {
    debug: true,
    retentionDays: 7,
    maxNumberOfVersions: 10,
    checkForUpdateStrategy: 'polling', // Cloudflare Workers uses polling
    storage: {
      driver: 'cloudflare-kv-binding',
      binding: 'SKEW_STORAGE',
      // namespaceId auto-detected from wrangler.toml
    },
  },

  // Cloudflare Workers configuration
  nitro: {
    preset: 'cloudflare',
    experimental: {
      wasm: true,
    },
  },

  // Ensure unique build ID for each deployment
  runtimeConfig: {
    app: {
      buildId: process.env.NUXT_DEPLOYMENT_ID || `dpl-${Date.now().toString(36)}`,
    },
    public: {
      deploymentId: process.env.NUXT_DEPLOYMENT_ID,
      buildId: process.env.NUXT_BUILD_ID,
    },
  },

  compatibilityDate: '2025-03-13',
})
