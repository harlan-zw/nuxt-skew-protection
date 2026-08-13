import { defineEventHandler, getHeader, setCookie } from '#nuxtseo/h3'
import { useRuntimeConfig } from '#nuxtseo/nitro'
import { resolveVercelCookiePath } from '../utils/vercel-cookie-path'

export default defineEventHandler(async (event) => {
  // Only handle document requests (not assets/API)
  const secFetchDest = getHeader(event, 'sec-fetch-dest')
  if (secFetchDest !== 'document') {
    return
  }

  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID
  if (!deploymentId) {
    return
  }

  const { skewProtection } = useRuntimeConfig(event)

  // Set Vercel's __vdpl cookie for document requests using h3's setCookie
  setCookie(event, '__vdpl', deploymentId, {
    path: resolveVercelCookiePath(skewProtection),
    sameSite: 'lax',
    secure: true,
    httpOnly: true,
  })
})
