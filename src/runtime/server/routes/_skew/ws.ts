import { defineEventHandler } from 'h3'

/**
 * WebSocket route for Cloudflare Durable Objects
 *
 * This route forwards WebSocket upgrade requests to the Durable Objects instance.
 * The Durable Object handles the actual WebSocket connection and version broadcasting.
 *
 * Only works on Cloudflare Workers with Durable Objects enabled.
 */
export default defineEventHandler(async (event) => {
  const env = event.context.cloudflare?.env

  // Check if Durable Objects binding is available
  if (!env?.VERSION_UPDATES) {
    return new Response('Durable Objects not configured', { status: 503 })
  }

  // Get or create Durable Object instance
  // Use a single instance ID for all connections to enable broadcasting
  const id = env.VERSION_UPDATES.idFromName('version-updates')
  const stub = env.VERSION_UPDATES.get(id)

  // Forward the request to the Durable Object
  return stub.fetch(event.node.req.url!, {
    headers: event.node.req.headers as HeadersInit,
  })
})
