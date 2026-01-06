import { defineNitroPlugin } from 'nitropack/runtime'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('skew:authorize-stats', async ({ event, authorize }) => {
    const session = await getUserSession(event)
    if (session.user) {
      authorize()
    }
  })
})
