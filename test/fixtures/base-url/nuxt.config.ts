import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Models an app deployed under a sub path with the standard Nuxt `app.baseURL`.
// Nitro mounts every server handler relative to `app.baseURL`, so the module
// must register baseURL relative routes while the client requests the full path.
export default defineNuxtConfig({
  modules: ['../../../src/module'],
  compatibilityDate: '2024-11-01',

  app: {
    baseURL: '/app/',
  },

  skewProtection: {
    debug: true,
    updateStrategy: 'sse',
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
    public: {
      deploymentId: process.env.NUXT_DEPLOYMENT_ID || 'dpl-local-v1',
    },
  },
})
