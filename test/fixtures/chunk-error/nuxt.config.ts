import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineNuxtConfig({
  modules: ['@nuxtjs/robots', '../../../src/module'],
  compatibilityDate: '2024-11-01',

  // SPA mode - server just serves static HTML, no SSR
  // This allows us to swap client chunks without breaking server rendering
  ssr: false,

  skewProtection: {
    debug: true,
    // Disable chunk preservation so old chunks are deleted on rebuild
    bundlePreviousDeploymentChunks: false,
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
