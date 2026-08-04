import { defineNitroPlugin } from '#nuxtseo/nitro'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('skew:authorize-stats', ({ authorize }) => {
    // Auto-authorize for tests
    authorize()
  })
})
