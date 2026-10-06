import { parse } from 'cookie-es'
import { createEventStream, defineEventHandler, getHeader, getQuery, getRequestIP } from '#nuxtseo/h3'
import { useNitroApp, useRuntimeConfig } from '#nuxtseo/nitro'
import { SKEW_MESSAGE_TYPE } from '../../../const'
import { getSkewProtectionCookieName } from '../../imports/cookie'

export default defineEventHandler(async (event) => {
  const nitroApp = useNitroApp()
  const stream = createEventStream(event)

  const serverVersion = useRuntimeConfig(event).app.buildId

  const send = (data: any) => {
    stream.push(JSON.stringify(data))
  }

  const connectionId = crypto.randomUUID()

  // Send connection ID so client can use it for route updates
  send({
    type: SKEW_MESSAGE_TYPE.CONNECTED,
    version: serverVersion,
    connectionId,
    timestamp: Date.now(),
  })

  const cookieName = getSkewProtectionCookieName()
  const clientVersion = (cookieName && parse(getHeader(event, 'cookie') || '')[cookieName]) || serverVersion
  const query = getQuery(event)
  const initialRoute = (query.route as string) || '/'
  const ip = getRequestIP(event, { xForwardedFor: true }) || undefined
  await nitroApp.hooks.callHook('skew:connection:open', {
    id: connectionId,
    version: clientVersion,
    route: initialRoute,
    ip,
    send,
  })

  let keepaliveTimeout: ReturnType<typeof setTimeout> | undefined
  const scheduleKeepalive = () => {
    keepaliveTimeout = setTimeout(() => {
      send({ type: 'keepalive', timestamp: Date.now() })
      scheduleKeepalive()
    }, 30000)
  }
  scheduleKeepalive()

  let cleanupDone = false
  const close = async () => {
    if (cleanupDone)
      return
    cleanupDone = true
    clearTimeout(keepaliveTimeout)
    await nitroApp.hooks.callHook('skew:connection:close', { id: connectionId })
    await stream.close()
  }

  stream.onClosed(close)
  return stream.send()
})
