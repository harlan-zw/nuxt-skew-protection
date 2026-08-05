export default defineNuxtConfig({
  modules: ['@vueuse/nuxt', 'nuxt-skew-protection'],
  nitro: { preset: 'netlify' },
  skewProtection: {
    mode: 'native',
    bundleAssets: false,
  },
})
