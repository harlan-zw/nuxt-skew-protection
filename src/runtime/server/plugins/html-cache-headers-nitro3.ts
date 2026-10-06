import type { RequestEvent } from 'nuxt/server'
import { defineNitroPlugin } from '#nuxtseo/nitro'
import { getSkewProtectionCookieName } from '../imports/cookie'
import { resolveHtmlCachePolicy, sharedCacheControlHeader, withoutCookie } from '../utils/html-cache-policy'

interface Nitro3ResponseHooks {
  hook: (name: 'response', callback: (response: Response, event: Pick<RequestEvent, 'req'>) => void) => void
}

export default defineNitroPlugin((nitroApp) => {
  // This module selects the adapter for Nitro 3's native response hook.
  const hooks = nitroApp.hooks as unknown as Nitro3ResponseHooks
  hooks.hook('response', (response, event) => {
    const headers = event.req.headers
    const cacheControl = sharedCacheControlHeader(name => response.headers.get(name) ?? undefined)
    const decision = resolveHtmlCachePolicy({
      method: event.req.method,
      secFetchDest: headers.get('sec-fetch-dest') ?? undefined,
      accept: headers.get('accept') ?? undefined,
      cookie: headers.get('cookie') ?? undefined,
      authorization: headers.get('authorization') ?? headers.get('proxy-authorization') ?? undefined,
    }, { status: response.status, cacheControl: cacheControl?.value })
    if (decision._tag !== 'shared-cacheable')
      return
    const name = getSkewProtectionCookieName()
    if (!name)
      return
    const cookies = response.headers.getSetCookie()
    const remaining = withoutCookie(cookies, name)
    if (remaining.length === cookies.length)
      return
    response.headers.delete('set-cookie')
    for (const cookie of remaining)
      response.headers.append('set-cookie', cookie)
  })
})
