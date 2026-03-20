import { defineEventHandler, getHeader } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
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
  const secFetchDest = getHeader(event, 'sec-fetch-dest')
  if (secFetchDest !== 'document')
    return

  const buildId = useRuntimeConfig(event).app.buildId
  if (!buildId)
    return

  setSkewProtectionCookie(event, buildId)
})
