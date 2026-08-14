import { defineNuxtPlugin } from '#app'

export default defineNuxtPlugin((nuxtApp) => {
  ;(window as any).__TEST_NUXT_APP__ = nuxtApp
})
