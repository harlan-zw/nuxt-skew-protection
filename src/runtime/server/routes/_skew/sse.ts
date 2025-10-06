import { createEventStream, defineEventHandler } from 'h3'
import { useNitroApp, useRuntimeConfig } from 'nitropack/runtime'

export default defineEventHandler(async (event) => {
  const nitroApp = useNitroApp()
  const stream = createEventStream(event)

  const config = useRuntimeConfig()
  const serverVersion = config.app.buildId

  // Send helper function
  const send = (data: any) => {
    stream.push(JSON.stringify(data))
  }

  // Send initial connection acknowledgment
  send({
    type: 'connected',
    version: serverVersion,
    timestamp: Date.now(),
  })

  // Send periodic keepalive (every 30 seconds)
  const keepaliveInterval = setInterval(() => {
    send({
      type: 'keepalive',
      timestamp: Date.now(),
    })
  }, 30000)

  const close = async () => {
    clearInterval(keepaliveInterval)
    await stream.close()
  }

  stream.onClosed(close)
  nitroApp.hooks.hook('close', close)
  process.on('SIGTERM', close)
  return stream.send()
})
