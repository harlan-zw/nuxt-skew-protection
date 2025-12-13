export default defineNuxtConfig({
  modules: ['../../../src/module'],
  compatibilityDate: '2024-11-01',

  nitro: {
    preset: 'netlify',
  },

  skewProtection: {
    debug: true,
    updateStrategy: 'polling',
    storage: {
      driver: 'upstash',
      url: process.env.UPSTASH_REDIS_REST_URL || 'https://fake-upstash.upstash.io',
      token: process.env.UPSTASH_REDIS_REST_TOKEN || 'fake-token',
      base: 'skew-protection',
    },
    retentionDays: 1,
    maxNumberOfVersions: 3,
  },
})
