import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineNuxtConfig({
  modules: ['../../../src/module'],
  compatibilityDate: '2024-11-01',

  nitro: {
    preset: 'cloudflare-durable',
    experimental: {
      websocket: true,
    },
  },

  skewProtection: {
    debug: true,
    checkForUpdateStrategy: 'ws',
    storage: {
      driver: 'cloudflare-kv-binding',
      binding: 'SKEW_STORAGE',
      // namespaceId auto-detected from wrangler.toml
    },
    retentionDays: 1,
    maxNumberOfVersions: 3,
  },

  runtimeConfig: {
    app: {
      buildId: process.env.NUXT_DEPLOYMENT_ID || undefined,
    },
    public: {
      deploymentId: process.env.NUXT_DEPLOYMENT_ID || 'dpl-cf-durable-v1',
    },
  },
})
