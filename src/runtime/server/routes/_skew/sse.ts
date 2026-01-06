import { createEventStream, defineEventHandler, getQuery } from 'h3'
import { useNitroApp, useRuntimeConfig } from 'nitropack/runtime'
import { SKEW_MESSAGE_TYPE } from '../../../const'
import { getSkewProtectionCookie } from '../../imports/cookie'

export default defineEventHandler(async (event) => {
  const nitroApp = useNitroApp()
  const stream = createEventStream(event)

  const serverVersion = useRuntimeConfig(event).app.buildId

  const send = (data: any) => {
    stream.push(JSON.stringify(data))
  }

  send({
    type: SKEW_MESSAGE_TYPE.CONNECTED,
    version: serverVersion,
    timestamp: Date.now(),
  })

  const connectionId = crypto.randomUUID()
  const clientVersion = getSkewProtectionCookie(event) || serverVersion

  // @ts-expect-error custom hook
  await nitroApp.hooks.callHook('skew:connection:open', {
    id: connectionId,
    version: clientVersion,
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
    process.off('SIGTERM', close)
    // @ts-expect-error custom hook
    await nitroApp.hooks.callHook('skew:connection:close', { id: connectionId })
    await stream.close()
  }

  stream.onClosed(close)
  process.on('SIGTERM', close)
  return stream.send()
})
