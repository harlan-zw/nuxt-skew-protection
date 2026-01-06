---
title: Nitro Hooks
description: Learn how to use Nitro hooks to track and respond to real-time connections.
---

Nitro hooks allow you to build custom functionality on top of the SSE/WebSocket connections.

## `'skew:connection:open'`{lang="ts"}

**Type:** `(payload: { id: string, version: string, route?: string, ip?: string, send: (data) => void }) => void`{lang="ts"}

Triggered when a client establishes an SSE or WebSocket connection.

| Property | Description |
|----------|-------------|
| `id` | Unique connection identifier |
| `version` | Client's build version (from cookie) |
| `route` | Initial route (requires `routeTracking: true`) |
| `ip` | Client IP address (requires `ipTracking: true`) |
| `send` | Function to send data to this specific client |

```ts [server/plugins/connections.ts]
import { defineNitroPlugin } from 'nitropack/runtime'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('skew:connection:open', ({ id, version, route, ip, send }) => {
    console.log(`Client ${id} connected on version ${version} from ${ip}`)

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

## `'skew:connection:route-update'`{lang="ts"}

**Type:** `(payload: { id: string, route: string }) => void`{lang="ts"}

Triggered when a client navigates to a different route. Requires `routeTracking: true`.

```ts [server/plugins/connections.ts]
import { defineNitroPlugin } from 'nitropack/runtime'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('skew:connection:route-update', ({ id, route }) => {
    console.log(`Client ${id} navigated to ${route}`)
  })
})
```

## `'skew:authorize-stats'`{lang="ts"}

**Type:** `(payload: { event?: H3Event | { headers?: Headers }, authorize: () => void }) => void`{lang="ts"}

Called when a client requests stats subscription. Call `authorize()` to allow the connection to receive stats updates.

::callout{type="info"}
For SSE, `event` is a full `H3Event` with cookies and session access. For WebSocket, `event` is `{ headers }` since WebSocket handlers don't expose H3Event. Both work with `getUserSession()` from nuxt-auth-utils.
::

```ts [server/plugins/skew-auth.ts]
import { defineNitroPlugin } from 'nitropack/runtime'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('skew:authorize-stats', async ({ event, authorize }) => {
    // With nuxt-auth-utils
    const session = await getUserSession(event)
    if (session.user?.role === 'admin') {
      authorize()
    }
  })
})
```

## `'skew:subscribe-stats'`{lang="ts"}

**Type:** `(payload: { id: string, event?: H3Event | { headers?: Headers } }) => void`{lang="ts"}

Triggered when a client requests stats subscription. The built-in handler calls `skew:authorize-stats` and manages subscriptions. You typically don't need to hook into this directly.

## `'skew:stats'`{lang="ts"}

**Type:** `(callback: (stats: { total: number, versions: Record<string, number>, routes: Record<string, number> }) => void) => void`{lang="ts"}

Retrieve current connection stats on-demand. Useful for API endpoints.

```ts [server/api/admin/stats.get.ts]
export default defineEventHandler(async (event) => {
  return new Promise((resolve) => {
    const nitroApp = useNitroApp()
    nitroApp.hooks.callHook('skew:stats', (stats) => {
      resolve(stats)
    })
  })
})
```

## Recipes

### Custom Connection Tracking

Build your own connection tracking without using the built-in `connectionTracking` option:

```ts [server/plugins/custom-tracking.ts]
import { defineNitroPlugin } from 'nitropack/runtime'

const connections = new Map<string, { version: string, ip?: string, connectedAt: Date }>()

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('skew:connection:open', ({ id, version, ip }) => {
    connections.set(id, { version, ip, connectedAt: new Date() })
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
