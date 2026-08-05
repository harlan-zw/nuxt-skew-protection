import { defineEventHandler, getHeader, setCookie } from '#nuxtseo/h3'
import { useRuntimeConfig } from '#nuxtseo/nitro'

export default defineEventHandler((event) => {
  if (getHeader(event, 'sec-fetch-dest') !== 'document')
    return

  const token = process.env.NETLIFY_SKEW_PROTECTION_TOKEN
  if (!token)
    return

  const runtimeConfig = useRuntimeConfig(event) as {
    skewProtection?: { netlifyCookiePath?: string }
  }
  setCookie(event, 'netlify-skew-token', token, {
    path: runtimeConfig.skewProtection?.netlifyCookiePath || '/',
    sameSite: 'lax',
    secure: true,
    httpOnly: true,
  })
})
