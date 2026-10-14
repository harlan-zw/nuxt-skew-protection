import { defineEventHandler, readBody } from 'nuxt/server'
import { useNitroApp } from '#nuxtseo/nitro'

export default defineEventHandler(async (event) => {
  const body = await readBody<unknown>(event)

  if (!body || typeof body !== 'object'
    || !('connectionId' in body) || typeof body.connectionId !== 'string' || !body.connectionId
    || !('route' in body) || typeof body.route !== 'string' || !body.route) {
    return { ok: false }
  }
  await useNitroApp().hooks.callHook('skew:connection:route-update', {
    id: body.connectionId,
    route: body.route,
  })

  return { ok: true }
})
