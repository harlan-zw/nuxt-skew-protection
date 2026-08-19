import type { HtmlCacheHeadersOptions } from '../utils/html-cache-policy'
import { defineEventHandler, getHeader } from '#nuxtseo/h3'
import { useRuntimeConfig } from '#nuxtseo/nitro'
import { getSkewProtectionCookie, setSkewProtectionCookie } from '../imports/cookie'
import { htmlCacheRequestFromEvent, resolveHtmlCacheRequestPolicy } from '../utils/html-cache-policy'

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

  // Most shared caches refuse to store a response carrying Set-Cookie, so
  // leaving the cookie on would make `htmlCacheHeaders` silently do nothing.
  // The value itself would have been correct, since a cached document really
  // was rendered by the build it names.
  //
  // The cost is real and worth stating: `isClientOutdated` and the version an
  // SSE connection reports both come from this cookie, and anonymous document
  // requests stop setting it. They fall back to the server's own build id.
  //
  // Both middlewares reach this verdict from the request alone, so neither
  // depends on the other running first.
  const htmlCache = useRuntimeConfig(event).skewProtection?.htmlCacheHeaders as HtmlCacheHeadersOptions | false | undefined
  const cacheable = resolveHtmlCacheRequestPolicy(htmlCache ?? false, htmlCacheRequestFromEvent(event, getHeader))
  if (cacheable._tag === 'cacheable')
    return

  setSkewProtectionCookie(event, buildId)
})
