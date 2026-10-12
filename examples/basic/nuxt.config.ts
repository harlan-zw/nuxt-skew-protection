export default defineNuxtConfig({
  modules: ['nuxt-skew-protection'],

  skewProtection: {
    // Check for new deployments with Nuxt's native manifest polling.
    updateStrategy: 'polling',
  },

  compatibilityDate: '2025-01-01',
})
