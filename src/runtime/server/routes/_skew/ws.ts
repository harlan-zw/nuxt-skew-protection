import { parse as parseCookie } from 'cookie-es'
import { defineWebSocketHandler } from 'h3'
import { useNitroApp, useRuntimeConfig } from 'nitropack/runtime'
import { SKEW_MESSAGE_TYPE } from '../../../const'
import { getSkewProtectionCookieName } from '../../imports/cookie'

export default defineWebSocketHandler({
  open(peer) {
    const serverVersion = useRuntimeConfig().app.buildId
    const cookieName = getSkewProtectionCookieName()

    peer.send(JSON.stringify({
      type: SKEW_MESSAGE_TYPE.CONNECTED,
      version: serverVersion,
      timestamp: Date.now(),
    }))

    const cookieHeader = peer.request?.headers?.get('cookie') || ''
    const cookies = parseCookie(cookieHeader)
    const clientVersion = cookies[cookieName] || serverVersion

    // Extract initial route from URL query param
    const url = new URL(peer.request?.url || '', 'http://localhost')
    const initialRoute = url.searchParams.get('route') || '/'

    // @ts-expect-error custom hook
    useNitroApp().hooks.callHook('skew:connection:open', {
      id: peer.id,
      version: clientVersion,
      route: initialRoute,
      send: (data: any) => peer.send(JSON.stringify(data)),
      peer,
    })
  },

  message(peer, message) {
    const text = message.text()
    if (text.includes('ping')) {
      peer.send(JSON.stringify({ type: 'pong' }))
      return
    }

    let data: { type?: string, route?: string }
    try {
      data = JSON.parse(text)
    }
    catch {
      return
    }

    if (data.type === SKEW_MESSAGE_TYPE.ROUTE_UPDATE && data.route) {
      // @ts-expect-error custom hook
      useNitroApp().hooks.callHook('skew:connection:route-update', {
        id: peer.id,
        route: data.route,
        peer,
      })
    }
    else if (data.type === SKEW_MESSAGE_TYPE.SUBSCRIBE_STATS) {
      // @ts-expect-error custom hook
      useNitroApp().hooks.callHook('skew:subscribe-stats', {
        id: peer.id,
        // Pass minimal event-like object for getUserSession compatibility
        event: { headers: peer.request?.headers },
        peer,
      })
    }
  },

  close(peer) {
    // @ts-expect-error custom hook
    useNitroApp().hooks.callHook('skew:connection:close', { id: peer.id, peer })
  },
})
