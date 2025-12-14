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

    // @ts-expect-error custom hook
    useNitroApp().hooks.callHook('skew:connection:open', {
      id: peer.id,
      version: clientVersion,
      send: (data: any) => peer.send(JSON.stringify(data)),
      peer,
    })
  },

  message(peer, message) {
    if (message.text().includes('ping')) {
      peer.send(JSON.stringify({ type: 'pong' }))
    }
  },

  close(peer) {
    // @ts-expect-error custom hook
    useNitroApp().hooks.callHook('skew:connection:close', { id: peer.id, peer })
  },
})
