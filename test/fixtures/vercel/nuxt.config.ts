import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineNuxtConfig({
  modules: ['@vueuse/nuxt', 'nuxt-skew-protection'],
  compatibilityDate: '2024-11-01',

  nitro: {
    preset: 'vercel',
  },

  skewProtection: {
    debug: true,
    checkForUpdateStrategy: 'polling',
    storage: {
      driver: 'fs',
      base: join(__dirname, '.skew-storage'),
    },
    retentionDays: 1,
    maxNumberOfVersions: 3,
  },

  runtimeConfig: {
    public: {
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || 'dpl-vercel-v1',
    },
  },
})
