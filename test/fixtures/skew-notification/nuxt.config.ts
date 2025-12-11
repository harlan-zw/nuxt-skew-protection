import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineNuxtConfig({
  modules: ['../../../src/module'],
  compatibilityDate: '2024-11-01',

  skewProtection: {
    debug: true,
    // Use SSE for real-time update detection
    updateStrategy: 'sse',
    storage: {
      driver: 'fs',
      base: join(__dirname, '.skew-storage'),
    },
  },

  runtimeConfig: {
    app: {
      buildId: process.env.NUXT_DEPLOYMENT_ID || undefined,
    },
  },
})
