import { createEventStream, defineEventHandler } from 'h3'
import { useNitroApp, useRuntimeConfig } from 'nitropack/runtime'

/**
 * Server-Sent Events endpoint for real-time version updates
 *
 * On connection:
 * - Client sends their version via query param
 * - Server immediately responds if client is outdated
 * - Connection stays open for future updates
 *
 * Compatible with: Node.js, Bun, Deno
 * NOT compatible with: Cloudflare Workers (no persistent connections)
 */
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
