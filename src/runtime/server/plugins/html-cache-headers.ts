import type { HtmlCacheHeadersOptions } from '../utils/html-cache-policy'
import { getHeader, getResponseHeader, getResponseStatus, setResponseHeader } from '#nuxtseo/h3'
import { defineNitroPlugin, useRuntimeConfig } from '#nuxtseo/nitro'
import {
  htmlCacheHeaderValues,
  htmlCacheRequestFromEvent,
  resolveHtmlCachePolicy,
} from '../utils/html-cache-policy'

/**
 * Marks anonymous document responses as cacheable by a shared cache.
 *
 * Runs on `beforeResponse` rather than as middleware, because the status code
 * decides the answer and middleware cannot see it. A transient 500 during a
 * deploy, cached for the whole window, would be a worse outage than the one it
 * came from.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event) => {
    const options = useRuntimeConfig(event).skewProtection?.htmlCacheHeaders as HtmlCacheHeadersOptions | false | undefined
    if (!options)
      return

    const decision = resolveHtmlCachePolicy(
      options,
      htmlCacheRequestFromEvent(event, getHeader),
      {
        status: getResponseStatus(event),
        hasSetCookie: Boolean(getResponseHeader(event, 'set-cookie')),
      },
    )
    if (decision._tag !== 'cacheable')
      return

    const headers = htmlCacheHeaderValues(options)
    setResponseHeader(event, 'Cache-Control', headers.cacheControl)
    // The portable header. Cloudflare, Fastly and Akamai all read it, and it
    // leaves the browser-facing policy above alone.
    setResponseHeader(event, 'CDN-Cache-Control', headers.cdnCacheControl)
  })
})
