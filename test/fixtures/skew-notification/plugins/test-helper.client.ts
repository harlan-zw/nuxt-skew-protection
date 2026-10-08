import { defineNuxtPlugin, useRoute, useSkewProtection } from '#imports'

// Test helper plugin - exposes nuxtApp for e2e testing
export default defineNuxtPlugin((nuxtApp) => {
  // Expose nuxtApp to window for testing
  window.__TEST_NUXT_APP__ = nuxtApp
  window.__TEST_SKEW_PROTECTION__ = useSkewProtection({ lazy: true })
  window.__TEST_OUTDATED__ = []
  window.__TEST_SKEW_PROTECTION__.onAppOutdated(manifest => window.__TEST_OUTDATED__.push(manifest.id))

  // Simulate prerendered page for the /prerendered route
  const route = useRoute()
  if (route.path === '/prerendered') {
    nuxtApp.payload.prerenderedAt = Date.now()
  }
})
