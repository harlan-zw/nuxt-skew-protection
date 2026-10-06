import { defineEventHandler, getRequestHeader, useRuntimeConfig } from 'nuxt/server'
import { getSkewProtectionCookie, setSkewProtectionCookie } from '../imports/cookie'

/**
 * Middleware that:
 * 1. Sets event.context.skewVersion on all requests (from cookie)
 * 2. Sets the skew-version cookie on document requests (HTML pages)
 */
export default defineEventHandler(async (event) => {
  // Always expose client version in event context for API handlers
  const clientVersion = getSkewProtectionCookie(event)
  if (clientVersion) {
    event.context.skewVersion = clientVersion
  }

  // Only set cookie on document requests
  const secFetchDest = getRequestHeader(event, 'sec-fetch-dest')
  if (secFetchDest !== 'document')
    return

  const buildId = useRuntimeConfig().app.buildId
  if (!buildId)
    return

  setSkewProtectionCookie(event, buildId)
})
