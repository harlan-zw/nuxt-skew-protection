import { getHeader, getResponseHeader, getResponseStatus, removeResponseHeader, setResponseHeader } from '#nuxtseo/h3'
import { defineNitroPlugin, useRuntimeConfig } from '#nuxtseo/nitro'
import { getSkewProtectionCookieName } from '../imports/cookie'
import { htmlCacheRequestFromEvent, resolveHtmlCachePolicy, withoutCookie } from '../utils/html-cache-policy'

/**
 * Drops the version cookie from documents a shared cache was asked to keep.
 *
 * Runs on `beforeResponse` rather than as middleware, because the answer needs
 * the response: the status decides whether the document is worth keeping, and
 * the app's own `cache-control` is the only signal that it wants one kept.
 * Reading it here also means it does not matter how the app set it, route rule
 * or plugin or handler.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event) => {
    if (!useRuntimeConfig(event).skewProtection?.htmlCache)
      return

    const decision = resolveHtmlCachePolicy(
      true,
      htmlCacheRequestFromEvent(event, getHeader),
      {
        status: getResponseStatus(event),
        cacheControl: getResponseHeader(event, 'cache-control') as string | undefined,
      },
    )
    if (decision._tag !== 'shared-cacheable')
      return

    const name = getSkewProtectionCookieName()
    if (!name)
      return

    const remaining = withoutCookie(
      getResponseHeader(event, 'set-cookie') as string | string[] | undefined,
      name,
    )
    if (remaining.length)
      setResponseHeader(event, 'set-cookie', remaining)
    else
      removeResponseHeader(event, 'set-cookie')
  })
})
