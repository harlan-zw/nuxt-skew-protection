import { defineNuxtModule } from '@nuxt/kit'
import SkewProtection from '../../../src/module'

const Pwa = defineNuxtModule({ meta: { name: '@vite-pwa/nuxt' } })

export default defineNuxtConfig({
  modules: [SkewProtection, ...(process.env.TEST_PWA_MODULE === '1' ? [Pwa] : [])],
  app: { baseURL: '/app/' },
  devtools: { enabled: false },
  skewProtection: { updateStrategy: 'polling', cookie: false, bundleAssets: false },
  compatibilityDate: '2026-10-06',
})
