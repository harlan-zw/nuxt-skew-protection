import { appendResponseHeader, getHeader, getResponseHeader, getResponseStatus, removeResponseHeader } from '#nuxtseo/h3'
import { defineNitroPlugin } from '#nuxtseo/nitro'
import { getSkewProtectionCookieName } from '../imports/cookie'
import {
  htmlCacheRequestFromEvent,
  readSetCookies,
  resolveHtmlCachePolicy,
  withoutCookie,
} from '../utils/html-cache-policy'

/**
 * Drops the version cookie from documents a shared cache was asked to keep.
 *
 * Runs on `beforeResponse` rather than as middleware, because the answer needs
 * the response: the status decides whether the document is worth keeping, and
 * the app's own `cache-control` is the only signal that it wants one kept.
 * Reading it here also means it does not matter how the app set it, route rule
 * or plugin or handler.
 *
 * A route rule is caught at build time and named there. A `cache-control` set
 * by a handler or a nitro plugin is not, and gets no warning at all. There is
 * nowhere to put one: the cookie middleware only registers outside dev
 * (`module.ts`), so nothing is ever dropped while `nuxt dev` runs, and a
 * per-route warning in production logs is noise for a header the author wrote
 * on purpose.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event) => {
    const decision = resolveHtmlCachePolicy(
      htmlCacheRequestFromEvent(event, getHeader),
      {
        status: getResponseStatus(event),
        cacheControl: getResponseHeader(event, 'cache-control'),
      },
    )
    if (decision._tag !== 'shared-cacheable')
      return

    const name = getSkewProtectionCookieName()
    if (!name)
      return

    const cookies = readSetCookies(
      event as never,
      getResponseHeader(event, 'set-cookie') as string | string[] | undefined,
    )
    const remaining = withoutCookie(cookies, name)
    // Nothing of ours to remove. Touching the header anyway risks rewriting an
    // app cookie into a different shape for no gain.
    if (remaining.length === cookies.length)
      return

    removeResponseHeader(event, 'set-cookie')
    // Appended one at a time. Setting an array works on h3 v1 but collapses to
    // a single malformed header on h3 v2, which is the same joining bug in the
    // other direction.
    for (const cookie of remaining)
      appendResponseHeader(event, 'set-cookie', cookie)
  })
})
