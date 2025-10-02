import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineNuxtConfig({
  modules: ['../../../src/module'],
  compatibilityDate: '2024-11-01',

  // Note: For skew protection to work, we need SSR enabled
  // so the server middleware can route old asset requests
  // Use prerendering for static generation with SSR support
  nitro: {
    prerender: {
      routes: ['/'],
    },
  },

  skewProtection: {
    debug: true,
    storage: {
      driver: 'fs',
      base: join(__dirname, '.skew-storage'),
    },
    retentionDays: 1,
    maxNumberOfVersions: 3,
  },

  runtimeConfig: {
    public: {
      deploymentId: process.env.NUXT_DEPLOYMENT_ID || 'dpl-local-v1',
    },
  },
})
