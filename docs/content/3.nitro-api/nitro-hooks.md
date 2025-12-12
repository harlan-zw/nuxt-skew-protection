---
title: Nitro Hooks
description: Learn how to use Nitro hooks to track and respond to real-time connections.
---

Nitro hooks allow you to build custom functionality on top of the SSE/WebSocket connections.

## `'skew:connection:open'`{lang="ts"}

**Type:** `(payload: { id: string, version: string, send: (data) => void }) => void`{lang="ts"}

Triggered when a client establishes an SSE or WebSocket connection.

| Property | Description |
|----------|-------------|
| `id` | Unique connection identifier |
| `version` | Client's build version (from cookie) |
| `send` | Function to send data to this specific client |

```ts [server/plugins/connections.ts]
import { defineNitroPlugin } from 'nitropack/runtime'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('skew:connection:open', ({ id, version, send }) => {
    console.log(`Client ${id} connected on version ${version}`)

    // Send a custom message to this client
    send({ type: 'welcome', message: 'Hello!' })
  })
})
```

## `'skew:connection:close'`{lang="ts"}

**Type:** `(payload: { id: string }) => void`{lang="ts"}

Triggered when a client disconnects from the SSE or WebSocket connection.

```ts [server/plugins/connections.ts]
import { defineNitroPlugin } from 'nitropack/runtime'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('skew:connection:close', ({ id }) => {
    console.log(`Client ${id} disconnected`)
  })
})
```

## Recipes

### Custom Connection Tracking

Build your own connection tracking without using the built-in `connectionTracking` option:

```ts [server/plugins/custom-tracking.ts]
import { defineNitroPlugin } from 'nitropack/runtime'

const connections = new Map<string, { version: string, connectedAt: Date }>()

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('skew:connection:open', ({ id, version }) => {
    connections.set(id, { version, connectedAt: new Date() })
  })

  nitroApp.hooks.hook('skew:connection:close', ({ id }) => {
    connections.delete(id)
  })
})
```

### Broadcast to All Clients

Send messages to all connected clients:

```ts [server/plugins/broadcast.ts]
import { defineNitroPlugin } from 'nitropack/runtime'

type SendFn = (data: any) => void
const clients = new Map<string, SendFn>()

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('skew:connection:open', ({ id, send }) => {
    clients.set(id, send)
  })

  nitroApp.hooks.hook('skew:connection:close', ({ id }) => {
    clients.delete(id)
  })

  // Expose broadcast function globally
  globalThis.broadcastToClients = (data: any) => {
    for (const send of clients.values()) {
      send(data)
    }
  }
})
```
