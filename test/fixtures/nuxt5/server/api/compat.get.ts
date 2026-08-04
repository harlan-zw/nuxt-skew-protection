import { useNitroApp } from 'nitro/app'
import { defineEventHandler } from 'nitro/h3'

export default defineEventHandler(async (event) => {
  const skewVersion: string | undefined = event.context.skewVersion
  const hooks = useNitroApp().hooks
  if (!hooks)
    throw new Error('Nitro hooks unavailable')

  await hooks.callHook('skew:subscribe-stats', {
    id: 'nuxt5-fixture',
    event,
  })
  await hooks.callHook('skew:authorize-stats', {
    event,
    authorize: () => {},
  })

  return {
    skewVersion: skewVersion ?? null,
  }
})
