import { defineNitroPlugin } from 'nitropack/runtime'

// Auto-authorize all connections for testing
export default defineNitroPlugin((nitroApp) => {
  // @ts-expect-error custom hook
  nitroApp.hooks.hook('skew:authorize-stats', ({ authorize }) => {
    authorize()
  })
})
