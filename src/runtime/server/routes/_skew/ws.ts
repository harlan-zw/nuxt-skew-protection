import { parse as parseCookie } from 'cookie-es'
import { defineWebSocketHandler } from 'h3'
import { useNitroApp, useRuntimeConfig } from 'nitropack/runtime'

export default defineWebSocketHandler({
  open(peer) {
    const runtimeConfig = useRuntimeConfig()
    const serverVersion = runtimeConfig.app?.buildId
    const skewConfig = runtimeConfig.public.skewProtection as Record<string, any>

    peer.send(JSON.stringify({
      type: 'connected',
      version: serverVersion,
      timestamp: Date.now(),
    }))

    const cookieHeader = peer.request?.headers?.get('cookie') || ''
    const cookies = parseCookie(cookieHeader)
    const cookieName = skewConfig?.cookie?.name || '__nkpv'
    const clientVersion = cookies[cookieName] || serverVersion

    // @ts-expect-error custom hook
    useNitroApp().hooks.callHook('skew:connection:open', {
      id: peer.id,
      version: clientVersion,
      send: (data: any) => peer.send(JSON.stringify(data)),
    })
  },

  message(peer, message) {
    if (message.text().includes('ping')) {
      peer.send(JSON.stringify({ type: 'pong' }))
    }
  },

  close(peer) {
    // @ts-expect-error custom hook
    useNitroApp().hooks.callHook('skew:connection:close', { id: peer.id })
  },
})
