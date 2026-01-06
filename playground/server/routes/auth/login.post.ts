import { createError, defineEventHandler, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string }>(event)

  // Demo login - in production use proper authentication
  if (body.email) {
    await setUserSession(event, {
      user: {
        email: body.email,
        name: body.email.split('@')[0],
        role: 'admin',
      },
    })
    return { success: true }
  }

  throw createError({ statusCode: 400, message: 'Email required' })
})
