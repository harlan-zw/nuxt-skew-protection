import type { Nuxt } from 'nuxt/schema'
import { getNitroVersion } from '@nuxt/kit'
import NuxtRobots from '@nuxtjs/robots'
import NuxtSiteConfig from 'nuxt-site-config'
import NuxtSkewProtection from 'nuxt-skew-protection'

function verifyBuilder(_options: unknown, nuxt: Nuxt) {
  nuxt.hook('modules:done', () => {
    const expected = 3
    const actual = getNitroVersion(nuxt)
    if (actual !== expected)
      throw new Error(`Expected Nitro ${expected}, resolved ${actual}`)
  })
}

export default defineNuxtConfig({
  workspaceDir: import.meta.dirname,
  vite: { resolve: { dedupe: ['nuxt', 'vue', 'vue-router'] } },
  future: { compatibilityVersion: 5 },
  modules: [verifyBuilder, NuxtRobots, NuxtSiteConfig, NuxtSkewProtection],
  site: { url: 'https://skew.example.com' },
  robots: { botDetection: true },

  compatibilityDate: '2026-06-10',

  nitro: { prerender: { routes: ['/__skew/health'], crawlLinks: false } },

  devtools: {
    enabled: false,
  },

  skewProtection: {
    bundleAssets: false,
    multiTab: false,
    reloadStrategy: false,
    updateStrategy: 'polling',
  },

  runtimeConfig: {
    app: {
      buildId: 'nuxt5-fixture-v1',
    },
  },
})
