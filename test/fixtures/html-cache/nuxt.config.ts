import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineNuxtConfig({
  modules: ['../../../src/module'],
  compatibilityDate: '2024-11-01',

  // The whole opt-in. No module option turns HTML caching on.
  routeRules: {
    '/cached': { headers: { 'cache-control': 'public, s-maxage=300' } },
    '/private': { headers: { 'cache-control': 'private, no-store' } },
  },

  skewProtection: {
    updateStrategy: 'polling',
    storage: {
      driver: 'fs',
      base: join(__dirname, '.skew-storage'),
    },
    retentionDays: 1,
    maxNumberOfVersions: 3,
  },

  runtimeConfig: {
    app: {
      buildId: process.env.NUXT_DEPLOYMENT_ID || undefined,
    },
  },
})
