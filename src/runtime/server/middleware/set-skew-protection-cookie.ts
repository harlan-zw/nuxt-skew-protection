import { defineEventHandler, getHeader } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { setSkewProtectionCookie } from '../imports/cookie'

/**
 * Middleware for document requests (HTML pages)
 * Sets the skew-version cookie based on current build ID
 */
export default defineEventHandler(async (event) => {
  // Only handle document requests
  const secFetchDest = getHeader(event, 'sec-fetch-dest')
  if (secFetchDest !== 'document')
    return

  const buildId = useRuntimeConfig(event).app.buildId
  if (!buildId)
    return

  setSkewProtectionCookie(event, buildId)
})
