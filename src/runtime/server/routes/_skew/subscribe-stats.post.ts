import { createError, defineEventHandler, readBody } from 'h3'
import { useNitroApp } from 'nitropack/runtime'

/**
 * POST endpoint for SSE connections to request stats subscription.
 * Since SSE is unidirectional, clients POST here to subscribe.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ connectionId?: string }>(event)

  if (!body.connectionId) {
    throw createError({ statusCode: 400, message: 'Missing connectionId' })
  }

  // @ts-expect-error custom hook
  await useNitroApp().hooks.callHook('skew:subscribe-stats', {
    id: body.connectionId,
    event,
  })

  return { ok: true }
})
