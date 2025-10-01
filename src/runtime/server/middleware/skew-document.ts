import { useRuntimeConfig } from '#imports'
import { defineEventHandler, getHeader, setCookie } from 'h3'

/**
 * Middleware for document requests (HTML pages)
 * Sets the skew-version cookie based on current build ID
 */
export default defineEventHandler(async (event) => {
  // Only handle document requests
  const secFetchDest = getHeader(event, 'sec-fetch-dest')
  if (secFetchDest !== 'document') {
    return
  }

  // Get current build ID
  const config = useRuntimeConfig(event)
  const currentBuildId = config.app.buildId

  if (!currentBuildId) {
    return
  }

  // Set cookie for this document request
  setCookie(event, 'skew-version', currentBuildId, {
    path: '/',
    sameSite: 'strict',
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 7, // 7 days
  })
})
