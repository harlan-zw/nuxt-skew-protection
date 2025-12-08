import { defineNuxtPlugin } from '#imports'

// Test helper plugin - exposes nuxtApp for e2e testing
export default defineNuxtPlugin((nuxtApp) => {
  // Expose nuxtApp to window for testing
  window.__TEST_NUXT_APP__ = nuxtApp
})
