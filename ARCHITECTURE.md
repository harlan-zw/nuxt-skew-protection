# Nuxt Skew Protection Architecture

## Primitive

Version skew starts when one browser session and one deployment target disagree about the active release.

A complete solution needs one of these properties:

1. Deployment affinity: every request from a release A client reaches release A assets and server behavior.
2. Cross release compatibility: release B keeps every resource and server contract that a release A client can request.

Portable mode provides only the asset part of the second property. It keeps old immutable build files available and asks active clients to reload after a deployment. It does not retain old API routes, server handlers, SSR behavior, or payload generation.

That limitation shapes the module. Reload detection reduces the server contract skew window. It cannot make an incompatible server rollout safe.

## Guarantees

Portable mode guarantees the following when the build completes successfully and storage remains available:

- Each retained asset is stored by release ID and full public path.
- Two files with the same basename in different directories remain distinct.
- A URL recorded by two releases must have identical bytes.
- Missing and corrupt stored assets fail the build.
- Retention cleanup runs before restore and metadata publication.
- The client manifest advertises only retained releases.
- Adapter server credentials are excluded from generated client config.

The module does not guarantee:

- Old server endpoint availability.
- Compatibility between old client code and a new API contract.
- Update targeting based on JavaScript that has already loaded.
- Continued access after the configured retention window.
- Atomic deployment across compute, CDN, and third party storage.

## Release flow

For portable asset retention, the Nitro `compiled` hook runs this sequence:

1. Collect files under `app.buildAssetsDir`.
2. Exclude mutable control files such as `builds/latest.json`.
3. Read and hash every protected file.
4. Reject changed bytes at an existing immutable URL.
5. Write release assets under `version-assets/{release}/{path}`.
6. Publish `version-records/{release}.json`.
7. Remove expired and excess release records with their assets.
8. Restore missing assets from retained releases into the public output.
9. Add retained release timestamps to Nuxt `latest.json` and current `meta/{id}.json`.
10. Patch Nitro's embedded static asset metadata for the changed latest manifest.

The release record is written after its assets. A failed record write can leave unreachable asset keys, but it cannot advertise an incomplete release. Storage backends do not expose a shared transaction primitive, so orphan cleanup remains a backend concern.

## Storage model

Each release has an independent record:

```json
{
  "schemaVersion": 2,
  "id": "build-id",
  "timestamp": "2026-08-05T10:00:00.000Z",
  "expires": "2026-09-04T10:00:00.000Z",
  "assets": {
    "_nuxt/entry.abc.js": "sha256"
  }
}
```

Independent records avoid one shared manifest read, modify, write race when deployments overlap. Asset keys include the release even when bytes are shared. This uses more storage than content deduplication, but cleanup ownership is explicit and concurrent releases cannot steal an asset reference from each other.

## Client update flow

Nuxt's `app:manifest:update` hook is the canonical update event.

- Polling lets Nuxt discover a newer `builds/latest.json`.
- SSE, WebSocket, and adapters report a server version, then the shared client engine fetches the latest manifest.
- Multi tab coordination forwards the complete manifest to tabs under the same module base path.
- Prompt, immediate, and idle reload strategies all react to the same Nuxt hook.

`useSkewProtection()` creates one engine per Nuxt app. The engine owns connection state, manifest state, message listeners, and the retry queue. A version mismatch retries manifest discovery with backoff until the new manifest is readable.

Loaded modules are not used as a safety signal. Once a module has executed, its file can disappear without breaking that module instance. The future risk comes from lazy imports and server requests that the old client has not made yet.

## Reload behavior

Reloads use `reloadNuxtApp({ force: true })` without persisting Nuxt state. State serialized by release A may be invalid under release B.

Idle reload waits until the tab has been inactive for five seconds or becomes hidden. Multi tab messages use a channel name derived from `basePath`, which prevents path mounted Nuxt apps on one origin from sharing deployment events.

## Platform modes

Portable mode uses retained build assets and one update strategy. Persistent Node servers default to SSE. Serverless and static presets default to polling. Cloudflare Durable Objects can use WebSocket when Nitro WebSocket support is enabled.

Native mode delegates the complete affinity contract to a provider. The module selects it only when Vercel skew protection or a Netlify skew protection token is available. Native mode disables module asset bundling and client update transport because the provider keeps the client on its deployment.

Hybrid mode combines provider affinity with an external, unpinned Nuxt manifest. The client polls `discoveryURL` to learn about the latest release while application requests remain pinned. The discovery origin must return a valid manifest and allow the browser request.

## Cookies

The portable version cookie records the client release for server observability and connection setup. Path mounted apps derive separate cookie names. `cookie: false` disables it; the client build ID remains available.

Provider affinity cookies have a separate contract. Vercel uses `__vdpl`; Netlify uses its generated skew protection cookie. They must not be confused with the module's `__nkpv` cookie.

## Adapter boundary

An adapter declares:

- A Zod schema for build config.
- A server broadcast function.
- A client module containing `subscribe`.
- Required packages.
- A `toPublicConfig` projection.

Only the projection is serialized into the generated client module. Pusher exposes its public key and cluster. Ably requires `authUrl`; its API key stays server side.

## Failure policy

Expected absence during manifest propagation remains retryable on the client. Build storage failures propagate and fail the build. Cleanup, restoration, hashing, and metadata errors are never silently swallowed because a successful deploy would otherwise claim protection it did not ship.

## Endpoint compatibility

Portable mode registers health, SSE, WebSocket, route, and statistics endpoints only in the current server release. After deployment, an old client calling an application endpoint reaches current behavior unless the platform supplies affinity.

Plan server changes with one of these approaches:

- Keep request and response contracts compatible for at least the client reload window.
- Introduce versioned API paths and remove them after the support window.
- Use platform deployment affinity that retains old compute.
- Force an immediate reload before an incompatible operation, while accepting that already in flight requests can still race.
