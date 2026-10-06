import { defineEventHandler } from 'nuxt/server'
import { useNitroApp } from '#nuxtseo/nitro'
import { getClientVersion, isClientOutdated } from '#skew-protection/server'

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
    clientVersion: getClientVersion(event),
    outdated: isClientOutdated(event),
  }
})
