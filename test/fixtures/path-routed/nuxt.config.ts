import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Models a worker that only owns `/pro/*` on a shared host (e.g. apps/pro).
// It serves its chunks from `/pro/_nuxt/` and sets NO explicit skew `basePath`
// or `cookie.name` — both are auto-detected from the mount point.
export default defineNuxtConfig({
  modules: ['../../../src/module'],
  compatibilityDate: '2024-11-01',

  app: {
    buildAssetsDir: '/pro/_nuxt/',
  },

  skewProtection: {
    debug: true,
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
    public: {
      deploymentId: process.env.NUXT_DEPLOYMENT_ID || 'dpl-local-v1',
    },
  },
})
