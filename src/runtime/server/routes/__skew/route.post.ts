import { defineEventHandler, readBody } from 'h3'
import { useNitroApp } from 'nitropack/runtime'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ connectionId: string, route: string }>(event)

  if (!body?.connectionId || !body?.route) {
    return { ok: false }
  }

  // @ts-expect-error custom hook
  await useNitroApp().hooks.callHook('skew:connection:route-update', {
    id: body.connectionId,
    route: body.route,
  })

  return { ok: true }
})
