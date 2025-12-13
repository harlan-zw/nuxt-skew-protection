import { createEventStream, defineEventHandler } from 'h3'
import { useNitroApp, useRuntimeConfig } from 'nitropack/runtime'
import { getSkewProtectionCookie } from '../../imports/cookie'

export default defineEventHandler(async (event) => {
  const nitroApp = useNitroApp()
  const stream = createEventStream(event)

  const config = useRuntimeConfig()
  const serverVersion = config.app.buildId

  const send = (data: any) => {
    stream.push(JSON.stringify(data))
  }

  send({
    type: 'connected',
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

  const keepaliveInterval = setInterval(() => {
    send({ type: 'keepalive', timestamp: Date.now() })
  }, 30000)

  let cleanupDone = false
  const close = async () => {
    if (cleanupDone)
      return
    cleanupDone = true
    clearInterval(keepaliveInterval)
    // @ts-expect-error custom hook
    await nitroApp.hooks.callHook('skew:connection:close', { id: connectionId })
    await stream.close()
  }

  stream.onClosed(close)
  nitroApp.hooks.hook('close', close)
  process.on('SIGTERM', close)
  return stream.send()
})
