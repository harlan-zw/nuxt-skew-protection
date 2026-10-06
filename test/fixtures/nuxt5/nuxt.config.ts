import type { Nuxt } from 'nuxt/schema'
import { getNitroVersion } from '@nuxt/kit'
import NuxtRobots from '@nuxtjs/robots'
import NuxtSiteConfig from 'nuxt-site-config'
import NuxtSkewProtection from 'nuxt-skew-protection'
import NuxtSeoShared from 'nuxtseo-shared'

// Allow the pinned nightly only in this consumer fixture.
{
  const modules: Array<{ getMeta?: () => Promise<{ compatibility?: { nuxt?: string } }> }> = [NuxtSkewProtection, NuxtSeoShared, NuxtRobots, NuxtSiteConfig]
  for (const module of modules) {
    const meta = await module.getMeta?.()
    if (!meta)
      throw new Error('The module must expose compatibility metadata.')
    meta.compatibility ||= {}
    meta.compatibility.nuxt = '^4.6.0 || ^5.0.0 || 5.0.0-2610061032-c7ad8cd'
  }
}

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
