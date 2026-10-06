import { createError, defineEventHandler, readBody } from 'nuxt/server'
import { useNitroApp } from '#nuxtseo/nitro'

/**
 * POST endpoint for SSE connections to request stats subscription.
 * Since SSE is unidirectional, clients POST here to subscribe.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ connectionId?: string }>(event)

  if (!body.connectionId) {
    throw createError({ status: 400, message: 'Missing connectionId' })
  }
  await useNitroApp().hooks.callHook('skew:subscribe-stats', {
    id: body.connectionId,
    event,
  })

  return { ok: true }
})
