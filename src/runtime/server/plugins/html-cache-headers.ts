import { appendResponseHeader, getHeader, getResponseHeader, getResponseStatus, removeResponseHeader } from '#nuxtseo/h3'
import { defineNitroPlugin } from '#nuxtseo/nitro'
import { getSkewProtectionCookieName } from '../imports/cookie'
import {
  htmlCacheRequestFromEvent,
  readSetCookies,
  resolveHtmlCachePolicy,
  withoutCookie,
} from '../utils/html-cache-policy'

/** Routes already warned about in dev, so a busy page warns once, not per hit. */
const warned = new Set<string>()

/** `event.path` on h3 v1, `event.url` on h3 v2. Read by shape, not by version. */
function pathOf(event: { path?: string, url?: { pathname?: string } }): string {
  return event.path ?? event.url?.pathname ?? '(unknown)'
}

/**
 * Drops the version cookie from documents a shared cache was asked to keep.
 *
 * Runs on `beforeResponse` rather than as middleware, because the answer needs
 * the response: the status decides whether the document is worth keeping, and
 * the app's own `cache-control` is the only signal that it wants one kept.
 * Reading it here also means it does not matter how the app set it, route rule
 * or plugin or handler.
 *
 * A route rule is caught at build time and named there. A header set by a
 * handler or a nitro plugin cannot be, so this warns in dev the first time it
 * strips on a route. That warning is the only signal an app doing it at runtime
 * ever gets.
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

    if (import.meta.dev) {
      const path = pathOf(event as never)
      if (!warned.has(path)) {
        warned.add(path)
        console.warn(`[nuxt-skew-protection] Dropped the version cookie from ${path}. A shared cache can store that document for ${decision.seconds}s. \`isClientOutdated\` falls back to the server build id there. If the page changes per visitor, set \`private\` in its cache-control.`)
      }
    }
  })
})
