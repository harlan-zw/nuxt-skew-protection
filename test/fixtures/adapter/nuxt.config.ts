import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fileAdapter } from './adapter'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineNuxtConfig({
  modules: ['../../../src/module'],
  compatibilityDate: '2024-11-01',

  skewProtection: {
    debug: true,
    updateStrategy: fileAdapter({
      endpoint: '/file-adapter-events',
      outFile: join(__dirname, '.broadcast'),
    }),
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
      deploymentId: process.env.NUXT_DEPLOYMENT_ID || 'dpl-adapter-v1',
    },
  },
})
