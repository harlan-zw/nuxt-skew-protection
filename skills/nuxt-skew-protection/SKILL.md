---
name: nuxt-skew-protection
description: Keep old Nuxt build chunks available after a deploy and prompt open tabs to reload, with the nuxt-skew-protection module. Use when a task mentions version skew, ChunkLoadError, "Failed to fetch dynamically imported module", stale chunks 404 after deploy, update notifications, SkewNotification, useSkewProtection, isClientOutdated, the __nkpv cookie, /__skew routes, or the skewProtection config key.
---

# nuxt-skew-protection

Tested against `nuxt-skew-protection` 1.5.5 on Nuxt 4.5.2 (requires Nuxt `>=4.0.0`).
At build time the module stores every build's assets, then copies the chunks of earlier builds back into `.output/public`.
In the browser it detects a new deploy and tells you when the chunks the tab loaded are gone. Docs: https://nuxtseo.com/docs/skew-protection

## Setup

Add `nuxt-skew-protection` to `modules`. `@nuxtjs/robots` is a required peer. The module installs it as a module dependency, so do not add it to `modules` a second time.

Build history lives in storage. The default is the `fs` driver at `node_modules/.cache/nuxt-seo/skew-protection`, relative to the project root.
If CI starts from a clean checkout, every build is the first build: the build logs `No previous versions found in storage` and no old chunk survives.
Persist that directory, or configure a shared driver (`redis`, `upstash`, `cloudflare-kv-binding`). On GitHub Actions, give each deploy a new key so the cache saves:

```yaml
- uses: actions/cache@v4
  with:
    path: node_modules/.cache/nuxt-seo
    key: nuxt-skew-${{ github.sha }}
    restore-keys: nuxt-skew-
```

Add a notification. Nothing shows until you render `<SkewNotification>` or call `useSkewProtection()`.

## Automatic behaviour

- **Build:** stores the assets, restores old chunks into `.output/public`, and adds `skewProtection.versions` to `/_nuxt/builds/latest.json`. Cleanup keeps 10 versions for 30 days (`maxNumberOfVersions`, `retentionDays`).
- **Cookie:** `__nkpv` holds the build id, for 7 days, `SameSite=Lax`. The server sets it only on requests with `sec-fetch-dest: document`. With `app.baseURL: '/app/'` the name becomes `__nkpv_app`.
- **Server context:** every request gets `event.context.skewVersion` from the cookie.
- **Service worker:** `/_nuxt-skew-sw.js` records which chunks the tab loaded.
- **Update strategy:** static output and Cloudflare Workers use `polling`, `cloudflare-durable` uses `ws`, and everything else uses `sse`. The client opens the connection when a component that uses the composable mounts.
- **Endpoints:** `/__skew/health`, `/__skew/sse`, and `/__skew/ws`, under `basePath`. With `app.baseURL: '/app/'` they sit at `/app/__skew/*`. A static build has none.
- **Multi tab:** a `BroadcastChannel` shares a detected deploy across tabs. Set `multiTab: false` to turn it off.

## Show an update prompt

`<SkewNotification>` is headless and renders inside `<ClientOnly>`. Put it in `app.vue` or a layout.

```vue
<template>
  <SkewNotification v-slot="{ isCurrentChunksOutdated, dismiss, reload, timeAgo }">
    <div v-if="isCurrentChunksOutdated" role="status">
      New version released {{ timeAgo }}.
      <button @click="reload">
        Reload
      </button>
      <button @click="dismiss">
        Not now
      </button>
    </div>
  </SkewNotification>
</template>
```

Pick the slot prop by intent:

- `isCurrentChunksOutdated`: the deploy deleted a chunk this tab loaded. Use it for the prompt.
- `isAppOutdated`: any new deploy. On a prerendered page this is always `false`, because the HTML carries a build id from build time.
- `isOpen`: either of the two.

`dismiss()` hides the prompt until the next deploy. `reload()` calls `reloadNuxtApp({ force: true, persistState: true })`.
To preview the UI, pass `force-open`. There is no `open` prop.

To reload without a prompt, set `reloadStrategy`:

- `'immediate'`: reload when chunks go stale.
- `'idle'`: reload after 60 seconds without user input, or as soon as the tab is hidden.
- `false`: do nothing. Handle `skew:chunks-outdated` yourself.

## React in code

`useSkewProtection()` is auto-imported. It returns refs and registers callbacks that the module removes on unmount.

```ts
const { onCurrentChunksOutdated, onAppOutdated, isAppOutdated, clientVersion } = useSkewProtection()

onCurrentChunksOutdated(({ invalidatedModules, passedReleases }) => {
  // the tab runs deleted code; save state, then reload
})
```

If the update was already detected, a callback runs at registration.
`useSkewProtection({ lazy: true })` does not connect on mount. Call `connect()` yourself.

## Reject stale clients on the server

The server helpers are not auto-imported. Import them from `nuxt-skew-protection/server`:

```ts
import { isClientOutdated } from 'nuxt-skew-protection/server'

export default defineEventHandler((event) => {
  if (isClientOutdated(event)) {
    setResponseStatus(event, 409)
    return { error: 'Client outdated', requiresReload: true }
  }
  return { ok: true }
})
```

`isClientOutdated` is `false` when the request has no cookie. The same entry exports `getClientVersion`, `getSkewProtectionCookie`, and `setSkewProtectionCookie`.

## Cloudflare

- `cloudflare-module` polls by default. Workers hold no SSE stream and no WebSocket.
- Real time needs `nitro.preset: 'cloudflare-durable'` and `nitro.experimental.websocket: true`.
- For KV storage, set `storage: { driver: 'cloudflare-kv-binding' }`. The build reads the `SKEW_PROTECTION` binding id from `nitro.cloudflare.wrangler.kv_namespaces` or `wrangler.json(c)`/`wrangler.toml`. With `@nuxthub/core`, set `storage.namespaceId`, or the build throws.
- On `cloudflare-module` and `cloudflare-durable`, the module adds your build asset path to `assets.run_worker_first`. Those requests count as Worker invocations.

## Traps

- **A headless browser test sees no updates.** Bot detection from `@nuxtjs/robots` matches `HeadlessChrome` and skips the SSE or WebSocket connection. Override the user agent in the test.
- **`useActiveConnections()` exists only with `connectionTracking: true`.** It needs `sse` or `ws`, and stats reach only connections that call `authorize()` in the Nitro hook `skew:authorize-stats`. See https://nuxtseo.com/docs/skew-protection/guides/live-connections
- **`sse` or `ws` on `nuxt generate` falls back to polling** with a warning. Polling uses Nuxt `experimental.checkOutdatedBuildInterval`, which defaults to one hour.
- **Vercel native skew protection turns off asset storage.** When `VERCEL_SKEW_PROTECTION_ENABLED=1` and `VERCEL_DEPLOYMENT_ID` are set, `bundleAssets` defaults to `false`.
- **A route rule that caches HTML with `max-age` and no `s-maxage` drops the cookie** for that route. The build warns. Use `s-maxage` for a CDN, or `private` for the browser only.
- **The cookie lasts 7 days.** It is not a session cookie. Use that duration in a cookie consent list.

## Version limits

1.x renamed these. The package binary rewrites them in place: `pnpm exec nuxt-skew-protection migrate`.

| 0.x | 1.x |
| --- | --- |
| `skew-protection:chunks-outdated` hook | `skew:chunks-outdated` |
| `isOutdated` | `isAppOutdated` |
| `bundlePreviousDeploymentChunks` | `bundleAssets` |
| `/_skew/*` routes | `/__skew/*` |
| `import { checkForUpdates } from '#skew-protection'` | `useSkewProtection().checkForUpdates` |

## Config

- `bundleAssets` (`true`): set `false` when your CDN already keeps old `/_nuxt/` files.
- `cookie`: set `false` to drop the cookie. `isClientOutdated` then always returns `false`.
- `basePath` (`/__skew`): the full public endpoint prefix, including `app.baseURL`. Auto-detected; set it only for custom routing.
- `updateStrategy`: pass `pusherAdapter({ key, cluster, appId, secret })` from `nuxt-skew-protection/adapters/pusher`, or `ablyAdapter({ key, authUrl })` from `nuxt-skew-protection/adapters/ably`, for a hosted realtime provider. Install `pusher-js` or `ably`. The build validates the config and broadcasts each new build id. For another provider, write one with `defineAdapter` from `nuxt-skew-protection/adapters`: https://nuxtseo.com/docs/skew-protection/providers/external
- Other options: https://nuxtseo.com/docs/skew-protection/api/config

## Debug

- `GET /__skew/health` returns `{ ok, version, uptime }`. Compare `version` with the client build id.
- `/_nuxt/builds/latest.json` lists every stored version under `skewProtection.versions`. One entry after a second deploy means storage did not persist.
- `debug: true` logs detection, service worker, and storage steps. Nuxt DevTools has a Skew Protection tab.
