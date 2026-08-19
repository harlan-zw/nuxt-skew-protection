import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Module from '../../../src/module'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineNuxtConfig({
  modules: [Module],
  compatibilityDate: '2025-10-10',

  nitro: {
    preset: 'cloudflare-module',
    cloudflare: {
      // Pinned below the local workerd build date, which refuses a newer one.
      wrangler: { compatibility_date: '2026-08-01' },
    },
  },

  // The whole opt-in. No module option turns HTML caching on.
  routeRules: {
    '/cached': { headers: { 'cache-control': 'public, s-maxage=300' } },
    '/private': { headers: { 'cache-control': 'private, no-store' } },
  },

  skewProtection: {
    updateStrategy: 'polling',
    storage: {
      driver: 'fs',
      base: `${__dirname}/.skew-storage`,
    },
    retentionDays: 1,
    maxNumberOfVersions: 3,
  },
})
