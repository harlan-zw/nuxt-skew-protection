import { defineNitroPlugin } from 'nitropack/runtime'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('skew:authorize-stats', ({ authorize }) => {
    // Auto-authorize for tests
    authorize()
  })
})
