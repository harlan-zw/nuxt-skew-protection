import { resolve } from 'pathe'

export default defineNuxtConfig({
  extends: ['nuxtseo-layer-devtools'],

  skewProtection: false,
  robots: false,

  imports: {
    autoImport: true,
  },

  nitro: {
    prerender: {
      routes: ['/', '/versions', '/connections', '/docs'],
    },
    output: {
      publicDir: resolve(__dirname, '../dist/devtools'),
    },
  },

  app: {
    baseURL: '/__nuxt-skew-protection',
  },
})
