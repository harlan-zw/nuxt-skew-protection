import type { Nuxt } from 'nuxt/schema'
import { getNitroVersion } from '@nuxt/kit'
import NuxtSkewProtection from 'nuxt-skew-protection'
import NuxtSeoShared from 'nuxtseo-shared'

// Allow the pinned nightly only in this consumer fixture.
if (process.env.NUXT_TEST_LANE === 'nuxt5') {
  const modules: Array<{ getMeta?: () => Promise<{ compatibility?: { nuxt?: string } }> }> = [NuxtSkewProtection, NuxtSeoShared]
  if (process.env.NUXT_TEST_INTEGRATIONS !== 'absent') {
    // Optional modules must stay unresolved in the absent integration lane.
    const { default: siteConfig } = await import('nuxt-site-config')
    modules.push(siteConfig)
    const { default: robots } = await import('@nuxtjs/robots')
    modules.push(robots)
  }
  for (const module of modules) {
    const meta = await module.getMeta?.()
    if (!meta)
      throw new Error('The packed module must expose compatibility metadata.')
    meta.compatibility ||= {}
    meta.compatibility.nuxt = '^4.6.0 || ^5.0.0 || 5.0.0-2610052343-36eafab'
  }
}

function verifyBuilder(_options: unknown, nuxt: Nuxt) {
  nuxt.hook('modules:done', () => {
    const expected = process.env.NUXT_TEST_LANE === 'nuxt5' ? 3 : 2
    const actual = getNitroVersion(nuxt)
    if (actual !== expected)
      throw new Error(`Expected Nitro ${expected}, resolved ${actual}`)
  })
}

export default defineNuxtConfig({
  future: { compatibilityVersion: process.env.NUXT_TEST_LANE === 'future5' ? 5 : 4 },
  modules: [verifyBuilder, ...(process.env.NUXT_TEST_INTEGRATIONS !== 'absent' ? ['@nuxtjs/robots', 'nuxt-site-config'] : []), NuxtSkewProtection],

  site: { url: 'https://skew.example.com' },
  robots: { botDetection: process.env.NUXT_TEST_INTEGRATIONS !== 'installed-disabled' },

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
