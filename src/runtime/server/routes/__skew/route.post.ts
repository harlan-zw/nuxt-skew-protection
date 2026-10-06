import { defineEventHandler, readBody } from 'nuxt/server'
import { useNitroApp } from '#nuxtseo/nitro'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ connectionId: string, route: string }>(event)

  if (!body?.connectionId || !body?.route) {
    return { ok: false }
  }
  await useNitroApp().hooks.callHook('skew:connection:route-update', {
    id: body.connectionId,
    route: body.route,
  })

  return { ok: true }
})
