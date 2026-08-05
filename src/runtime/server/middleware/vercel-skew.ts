import { defineEventHandler, getHeader, setCookie } from '#nuxtseo/h3'
import { useRuntimeConfig } from '#nuxtseo/nitro'

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

  const runtimeConfig = useRuntimeConfig(event) as {
    skewProtection?: { vercelCookiePath?: string }
  }

  // Set Vercel's __vdpl cookie for document requests using h3's setCookie
  setCookie(event, '__vdpl', deploymentId, {
    path: runtimeConfig.skewProtection?.vercelCookiePath || '/',
    sameSite: 'lax',
    secure: true,
    httpOnly: true,
  })
})
