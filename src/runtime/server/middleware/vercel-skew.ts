import { defineEventHandler, getHeader, setCookie } from 'h3'

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

  // Set Vercel's __vdpl cookie for document requests using h3's setCookie
  setCookie(event, '__vdpl', deploymentId, {
    path: '/',
    sameSite: 'strict',
    secure: true,
    httpOnly: true,
  })
})
