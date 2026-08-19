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
 * Runs on `beforeResponse` rather than as middleware, for two reasons that both
 * need the response: the status code decides whether the document is worth
 * keeping, and a `Cache-Control` the app already set means the app has its own
 * policy and this one stands down.
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
        hasCacheControl: Boolean(getResponseHeader(event, 'cache-control')),
      },
    )
    if (decision._tag !== 'cacheable')
      return

    const headers = htmlCacheHeaderValues(decision.rule)
    setResponseHeader(event, 'Cache-Control', headers.cacheControl)
    // The portable header. Cloudflare, Fastly and Akamai all read it, and it
    // leaves the browser-facing policy above alone.
    setResponseHeader(event, 'CDN-Cache-Control', headers.cdnCacheControl)
  })
})
