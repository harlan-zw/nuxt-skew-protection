export default defineNuxtConfig({
  modules: [
    '@nuxthub/core',
    'nuxt-skew-protection',
  ],

  nitro: {
    experimental: {
      websocket: true,
    },
  },

  alias: {
    picomatch: 'unenv/mock/proxy-cjs',
  },

  hub: {
    database: true,
    kv: true,
    blob: true,
    workers: true,
  },

  skewProtection: {
    debug: true,
    // By default uses fs storage (node_modules/.cache/nuxt/skew-protection)
    // To use Cloudflare KV, explicitly configure:
    // storage: {
    //   driver: 'cloudflare-kv-binding',
    //   binding: 'KV',
    //   base: 'skew:',
    //   namespaceId: 'your-production-kv-namespace-id', // Required for build-time
    // },
  },

  compatibilityDate: '2025-03-13',
})
