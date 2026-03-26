import { defineNuxtPlugin, useRoute } from '#imports'

// Test helper plugin - exposes nuxtApp for e2e testing
export default defineNuxtPlugin((nuxtApp) => {
  // Expose nuxtApp to window for testing
  window.__TEST_NUXT_APP__ = nuxtApp

  // Simulate prerendered page for the /prerendered route
  const route = useRoute()
  if (route.path === '/prerendered') {
    nuxtApp.payload.prerenderedAt = Date.now()
  }
})
