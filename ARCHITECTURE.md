# Nuxt Skew Protection - Architecture

## Overview

This module provides version skew protection for Nuxt applications through:
1. **Version Tracking** - Maintains multiple build versions to prevent 404 errors on old sessions
2. **Real-time Updates** - Notifies users when a new version is deployed using polling, SSE, or WebSockets
3. **Intelligent Notifications** - Only prompts users when their loaded modules become invalidated
4. **Universal Storage** - Works on any platform using unstorage (filesystem, S3, Redis, etc.)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              ARCHITECTURE OVERVIEW                   │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Build-Time (src/module.ts):                        │
│  ┌────────────────────────────────────────┐        │
│  │ 1. Detect platform & update strategy   │        │
│  │ 2. Configure storage (unstorage)        │        │
│  │ 3. Register middleware & plugins        │        │
│  │ 4. Setup build hooks                    │        │
│  └────────────────────────────────────────┘        │
│                     │                                │
│                     ▼                                │
│  nitro:build:public-assets hook:                    │
│  ┌────────────────────────────────────────┐        │
│  │ 1. Collect /_nuxt/* assets from build  │        │
│  │ 2. Update version manifest              │        │
│  │ 3. Store assets in storage (versioned) │        │
│  │ 4. Restore old assets to public/        │        │
│  │ 5. Augment builds/latest.json           │        │
│  │ 6. Cleanup expired versions             │        │
│  └────────────────────────────────────────┘        │
│                                                      │
│  Runtime - Server Middleware:                       │
│  ┌────────────────────────────────────────┐        │
│  │ set-skew-protection-cookie.ts           │        │
│  │  → Sets __nkpv cookie on HTML requests │        │
│  │  → Cookie = current buildId             │        │
│  │                                          │        │
│  │ vercel-skew.ts (Vercel only)            │        │
│  │  → Sets __vdpl cookie for Vercel        │        │
│  └────────────────────────────────────────┘        │
│                                                      │
│  Runtime - Update Notifications:                    │
│  ┌────────────────────────────────────────┐        │
│  │ Strategy: polling (default)             │        │
│  │  → Nuxt's built-in builds/latest.json  │        │
│  │                                          │        │
│  │ Strategy: sse (Node.js compatible)      │        │
│  │  → /_skew/sse endpoint                  │        │
│  │  → Real-time SSE connection             │        │
│  │                                          │        │
│  │ Strategy: ws (Cloudflare Durable)       │        │
│  │  → /_skew/ws endpoint                   │        │
│  │  → WebSocket connection                 │        │
│  └────────────────────────────────────────┘        │
│                                                      │
│  Runtime - Client Plugins:                          │
│  ┌────────────────────────────────────────┐        │
│  │ 0.skew-protection.ts (root)             │        │
│  │  → Sets up version tracking             │        │
│  │  → Listens to app:manifest:update       │        │
│  │  → Provides $skewProtection             │        │
│  │                                          │        │
│  │ sw-track-user-modules.client.ts         │        │
│  │  → Registers service worker             │        │
│  │  → Tracks loaded JS modules             │        │
│  │  → Detects invalidated modules          │        │
│  │  → Fires skew-protection:module-        │        │
│  │    -invalidated hook                    │        │
│  └────────────────────────────────────────┘        │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Core Components

### 1. Build-Time Asset Management (src/utils/version-manager.ts)

The `createAssetManager` function handles all build-time operations:

**Asset Collection:**
- Scans `public/_nuxt/` for all build assets
- Collects asset paths (e.g., `_nuxt/entry.abc123.js`)

**Version Manifest:**
```typescript
interface VersionManifest {
  current: string                           // Current build ID
  versions: Record<string, {
    timestamp: string                       // When this version was built
    expires: string                         // When to clean up this version
    assets: string[]                        // All assets in this version
    deletedChunks?: string[]                // Chunks removed in this version
  }>
  deploymentMapping?: Record<string, string> // deploymentId → buildId
  fileIdToVersion?: Record<string, string>   // fileId → buildId (for deduplication)
}
```

**Key Operations:**
1. **updateVersionsManifest()** - Adds current build to manifest, calculates deletedChunks
2. **storeAssetsInStorage()** - Stores assets with deduplication (same hash = same file)
3. **restoreOldAssetsToPublic()** - Copies old version assets back to public/ folder
4. **augmentBuildMetadata()** - Adds skewProtection data to builds/latest.json
5. **cleanupExpiredVersions()** - Removes old versions based on retention policy

**Deduplication Strategy:**
- Extracts file ID (hash) from asset path (e.g., "ABC123.js" from "ABC123.DEF456.js")
- Only stores one copy of each file ID across all versions
- When new build includes same hash, removes it from old version's storage

### 2. Runtime Cookie Management

**Server-side (src/runtime/server/imports/cookie.ts):**
- `getSkewProtectionCookie(event)` - Reads `__nkpv` cookie
- `setSkewProtectionCookie(event, buildId)` - Sets `__nkpv` cookie

**Client-side (src/runtime/app/composables/useSkewProtectionCookie.ts):**
- `useSkewProtectionCookie()` - Reactive cookie reference
- Defaults to current buildId

**Middleware (src/runtime/server/middleware/set-skew-protection-cookie.ts):**
- Runs on all document requests (HTML pages)
- Sets `__nkpv` cookie to current buildId
- Ensures users always have a valid version cookie

### 3. Update Detection Strategies

The module supports three strategies for detecting new deployments:

**Strategy 1: Polling (default, works everywhere)**
- Uses Nuxt's built-in `experimental.checkOutdatedBuildInterval`
- Polls `builds/latest.json` periodically
- No server-side code needed
- Selected automatically for static sites

**Strategy 2: SSE (Node.js, Bun, Deno)**
- Endpoint: `/_skew/sse` (src/runtime/server/routes/_skew/sse.ts)
- Plugin: `check-updates-sse.client.ts`
- Persistent connection sends version updates in real-time
- Keepalive every 30 seconds
- NOT compatible with Cloudflare Workers (no persistent connections)

**Strategy 3: WebSocket (Cloudflare Durable Objects)**
- Endpoint: `/_skew/ws` (src/runtime/server/routes/_skew/ws.ts)
- Plugin: `check-updates-websocket.client.ts`
- Bidirectional WebSocket connection
- Heartbeat every 30 seconds
- Requires `experimental.websockets` enabled
- Requires `cloudflare-durable` preset

### 4. Intelligent Module Invalidation

**Service Worker (sw/sw.js):**
- Intercepts all JavaScript fetch requests
- Tracks loaded module URLs in a Set
- Responds to messages: `GET_MODULES`, `CHECK_MODULE`, `RESET_MODULES`

**Plugin (src/runtime/app/plugins/sw-track-user-modules.client.ts):**
- Registers service worker at `/sw.js`
- Listens to `app:manifest:update` hook
- When new version detected:
  1. Gets list of loaded modules from service worker
  2. Extracts deletedChunks from builds/latest.json manifest
  3. Checks if any loaded modules are in deletedChunks
  4. If yes, fires `skew-protection:module-invalidated` hook

**Why this matters:**
- Only notifies users when their *current session* is affected
- Avoids unnecessary "update available" popups
- Provides urgency signal: "Your loaded code was deleted, please refresh"

## Public APIs

### Composables

**useSkewProtection()** (src/runtime/app/composables/useSkewProtection.ts)
```typescript
const skew = useSkewProtection()

// Reactive state
skew.manifest           // NuxtAppManifestMeta | null
skew.currentVersion     // string (user's build ID)
skew.isOutdated         // Ref<boolean>

// Methods
skew.checkForUpdates()  // Manually trigger update check
skew.onCurrentModulesInvalidated(callback) // Hook for module invalidation
```

**useSkewProtectionCookie()** (src/runtime/app/composables/useSkewProtectionCookie.ts)
```typescript
const versionCookie = useSkewProtectionCookie()
// Returns reactive cookie reference (CookieRef<string>)
```

### Component

**SkewNotification** (src/runtime/app/components/SkewNotification.vue)

Headless component that provides notification logic:
```vue
<template>
  <SkewNotification v-slot="{ isOpen, dismiss, reload, timeAgo, releaseDate }">
    <!-- Your custom UI -->
    <div v-if="isOpen">
      <p>New version available!</p>
      <button @click="reload">Reload</button>
      <button @click="dismiss">Dismiss</button>
    </div>
  </SkewNotification>
</template>
```

Props:
- `open` - Manual control over open state

Slot props:
- `isOpen` - Whether notification should be shown
- `dismiss()` - Dismiss notification
- `reload()` - Trigger reload
- `timeAgo` - Human-readable time since release
- `releaseDate` - Release date object

### Hooks

**app:manifest:update** (Nuxt built-in)
```typescript
nuxtApp.hooks.hook('app:manifest:update', (manifest) => {
  // Called when new version detected
  // manifest: NuxtAppManifestMeta
})
```

**skew-protection:module-invalidated** (Custom)
```typescript
nuxtApp.hooks.hook('skew-protection:module-invalidated', (payload) => {
  // Called when user's loaded modules are deleted
  // payload: { deletedChunks: string[], invalidatedModules: string[] }
})
```

### Server Utilities

**nuxt-skew-protection/server** (src/runtime/server/index.ts)

```typescript
import { getSkewProtectionCookie, setSkewProtectionCookie, isClientOutdated } from 'nuxt-skew-protection/server'

export default defineEventHandler((event) => {
  const version = getSkewProtectionCookie(event)
  setSkewProtectionCookie(event, 'new-build-id')
  const outdated = isClientOutdated(event) // boolean
})
```

## Key Design Decisions

### 1. Universal Storage Approach

Instead of platform-specific implementations, the module uses a **single universal approach** that works everywhere:

**Storage Strategy:**
- Uses unstorage for flexibility (filesystem, S3, Redis, Cloudflare KV, etc.)
- Stores versioned assets in storage during build
- Restores old assets to `public/` folder during build
- Old assets become part of the deployment package

**Benefits:**
- ✅ Works on any platform (Node.js, Cloudflare, Vercel, Netlify, static hosting)
- ✅ No runtime asset proxying or routing needed
- ✅ Assets served as static files (fast, cacheable)
- ✅ No CDN conflicts (assets always served from origin)
- ✅ Simpler architecture (no platform-specific middleware for assets)

### 2. Asset Deduplication

**Problem:** Multiple versions can share many identical files (vendor chunks, framework code)

**Solution:** File ID-based deduplication
- Extract file ID (hash) from asset path
- Store only one copy per hash across all versions
- Update `fileIdToVersion` mapping when new build reuses a hash
- Remove duplicate from old version's storage

**Result:** Significantly reduced storage usage

### 3. Intelligent Notifications

**Problem:** Don't want to spam users with "update available" for every deploy

**Solution:** Module invalidation detection
1. Service worker tracks which JS modules user has loaded
2. Build manifest includes `deletedChunks` for each version
3. When new version detected, check if user's loaded modules are deleted
4. Only fire `skew-protection:module-invalidated` if user is affected

**Result:** Users only notified when their session is truly broken

### 4. Three Update Strategies

**Why three strategies?**
- Different platforms have different capabilities
- Polling: Universal, works everywhere
- SSE: Real-time updates for Node.js-compatible platforms
- WebSocket: Real-time updates for Cloudflare Durable Objects

**Auto-detection:**
- Static sites → Polling
- Cloudflare (cloudflare-durable preset) → WebSocket
- Node.js/Bun/Deno → SSE (default)
- Manual override via `checkForUpdateStrategy` option

### 5. Integration with Nuxt's Native Mechanisms

**Builds metadata:**
- Augments `builds/latest.json` with skewProtection data
- Augments `builds/meta/{buildId}.json` with version-specific data
- Works with Nuxt's existing `app:manifest:update` hook

**Why this matters:**
- Compatible with Nuxt's chunk-reload plugin
- Uses standard Nuxt conventions
- Minimal disruption to existing Nuxt behavior

### 6. Cookie-Based Version Tracking

**Cookie name:** `__nkpv` (Nuxt Kit Protection Version)

**How it works:**
- Middleware sets cookie on every document request
- Cookie value = current buildId
- Client reads cookie to know their version
- Server can check if client is outdated

**Vercel Integration:**
- Also sets `__vdpl` cookie for Vercel's native skew protection
- Works alongside Vercel's infrastructure

## Complete Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         BUILD TIME                                │
└──────────────────────────────────────────────────────────────────┘

1. Module Setup (src/module.ts)
   ├─► Detect platform (Cloudflare/Vercel/generic)
   ├─► Configure unstorage (fs/s3/redis/kv)
   ├─► Determine update strategy (polling/sse/ws)
   ├─► Register middleware & plugins
   └─► Register build hooks

2. nitro:build:public-assets Hook (runs after Nuxt builds assets)
   │
   ├─► Asset Manager: getAssetsFromBuild()
   │   └─► Scans public/_nuxt/ → ["_nuxt/entry.abc123.js", ...]
   │
   ├─► Asset Manager: updateVersionsManifest()
   │   ├─► Adds current build to manifest
   │   ├─► Calculates deletedChunks (vs previous version)
   │   └─► Saves to storage/version-manifest.json
   │
   ├─► Asset Manager: storeAssetsInStorage()
   │   ├─► For each asset, extract fileId (hash)
   │   ├─► Store in storage/{buildId}/{asset}
   │   ├─► Check if fileId exists in previous version
   │   ├─► If yes, remove from old version (deduplication)
   │   └─► Update fileIdToVersion mapping
   │
   ├─► Asset Manager: restoreOldAssetsToPublic()
   │   ├─► For each old version in manifest
   │   ├─► Skip assets that exist in current build
   │   ├─► Skip assets with same fileId as current build
   │   └─► Copy old assets to public/_nuxt/
   │       Result: public/_nuxt/ contains ALL versions
   │
   ├─► Asset Manager: updateDeploymentMapping()
   │   └─► Maps deploymentId → buildId for version tracking
   │
   ├─► Asset Manager: augmentBuildMetadata()
   │   ├─► Adds skewProtection data to builds/latest.json:
   │   │   { versions: {...}, deploymentMapping: {...} }
   │   └─► Adds version-specific data to builds/meta/{buildId}.json:
   │       { assets: [...], deletedChunks: [...] }
   │
   └─► Asset Manager: cleanupExpiredVersions()
       ├─► Remove versions older than retentionDays
       ├─► Remove versions beyond maxNumberOfVersions
       └─► Update manifest and storage

┌──────────────────────────────────────────────────────────────────┐
│                        RUNTIME - SERVER                           │
└──────────────────────────────────────────────────────────────────┘

Middleware: set-skew-protection-cookie.ts (on every HTML request)
├─► Checks sec-fetch-dest === 'document'
├─► Gets current buildId from runtimeConfig
└─► Sets __nkpv cookie = buildId

Middleware: vercel-skew.ts (Vercel only, on HTML requests)
└─► Sets __vdpl cookie for Vercel's native skew protection

Route: /_skew/sse (SSE strategy only)
├─► Client connects with persistent connection
├─► Server sends initial version
├─► Sends keepalive every 30s
└─► On new deployment, sends version update

Route: /_skew/ws (WebSocket strategy only)
├─► Client connects via WebSocket
├─► Server sends initial version
├─► Heartbeat every 30s
└─► On new deployment, sends version update

┌──────────────────────────────────────────────────────────────────┐
│                       RUNTIME - CLIENT                            │
└──────────────────────────────────────────────────────────────────┘

Plugin: 0.skew-protection.ts (root plugin)
├─► Gets currentVersion from cookie or buildId
├─► Creates reactive refs: manifest, latestVersion, isOutdated
├─► Listens to app:manifest:update hook
└─► Provides $skewProtection globally

Plugin: sw-track-user-modules.client.ts (service worker plugin)
├─► Registers service worker at /sw.js
├─► Service Worker intercepts all JS fetch requests
│   └─► Tracks loaded modules in Set
├─► Listens to app:manifest:update hook
├─► When new version detected:
│   ├─► Gets list of loaded modules from SW
│   ├─► Gets deletedChunks from manifest
│   ├─► Checks intersection
│   └─► If user's modules are deleted:
│       └─► Fire skew-protection:module-invalidated hook
└─► Provides getLoadedModules() helper

Plugin: check-updates-sse.client.ts (SSE strategy only)
├─► Connects to /_skew/sse
├─► Listens for version updates
└─► Calls fetchLatestManifest() on version change
    └─► Fires app:manifest:update hook

Plugin: check-updates-websocket.client.ts (WebSocket strategy only)
├─► Connects to /_skew/ws
├─► Listens for version updates
└─► Fires app:manifest:update hook directly

Polling Strategy (default)
└─► Nuxt's built-in checkOutdatedBuildInterval
    └─► Polls builds/latest.json
        └─► Fires app:manifest:update hook

┌──────────────────────────────────────────────────────────────────┐
│                         USER EXPERIENCE                           │
└──────────────────────────────────────────────────────────────────┘

Component: SkewNotification.vue
├─► Calls useSkewProtection()
├─► Listens to onCurrentModulesInvalidated()
└─► Shows notification when modules invalidated
    ├─► Provides isOpen, dismiss(), reload() to slot
    └─► User sees: "New version available, please reload"

User Flow:
1. User visits site → Gets __nkpv cookie with buildId
2. User navigates → Service worker tracks loaded modules
3. New deployment happens → New buildId deployed
4. Update detection (polling/sse/ws) → Detects new version
5. app:manifest:update fired → manifest.value updated
6. SW plugin checks loaded modules vs deletedChunks
7. If intersection found → skew-protection:module-invalidated fired
8. SkewNotification shows → User sees notification
9. User clicks reload → window.location.reload()
10. User gets new version → New __nkpv cookie set
```

## Configuration

### Module Options (nuxt.config.ts)

```typescript
export default defineNuxtConfig({
  modules: ['nuxt-skew-protection'],

  skewProtection: {
    // Storage configuration (required for non-Vercel platforms)
    storage: {
      driver: 'fs',  // or 's3', 'redis', 'cloudflare-kv', etc.
      base: 'node_modules/.cache/nuxt/skew-protection', // for fs driver
      // For other drivers, see unstorage documentation
    },

    // Retention settings
    retentionDays: 30,           // How long to keep old versions
    maxNumberOfVersions: 10,     // Maximum versions to retain

    // Update detection strategy
    checkForUpdateStrategy: 'sse', // 'polling' | 'sse' | 'ws'
    // Auto-detected based on platform if not specified:
    // - Static sites → 'polling'
    // - Cloudflare Durable → 'ws'
    // - Node.js/Bun/Deno → 'sse'

    // Cookie configuration
    cookieName: '__nkpv',        // Cookie name for version tracking
    cookie: {
      path: '/',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 60, // 60 days
    },

    // Enable debug logging
    debug: false,

    // Enable/disable module
    enabled: true,
  },
})
```

### Storage Driver Examples

**Filesystem (default):**
```typescript
storage: {
  driver: 'fs',
  base: 'node_modules/.cache/nuxt/skew-protection'
}
```

**Cloudflare KV:**
```typescript
storage: {
  driver: 'cloudflare-kv-binding',
  binding: 'SKEW_PROTECTION_KV'
}
```

**Redis:**
```typescript
storage: {
  driver: 'redis',
  host: 'localhost',
  port: 6379,
  base: 'skew-protection'
}
```

**S3:**
```typescript
storage: {
  driver: 's3',
  bucket: 'my-bucket',
  region: 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
}
```

See [unstorage documentation](https://unstorage.unjs.io/) for all available drivers.

### Platform-Specific Configuration

**Vercel:**
```bash
# Enable Vercel's native skew protection alongside this module
VERCEL_SKEW_PROTECTION_ENABLED=1
```

**Cloudflare Workers (WebSocket strategy):**
```typescript
export default defineNuxtConfig({
  nitro: {
    preset: 'cloudflare-durable',
    experimental: {
      websockets: true  // Required for WebSocket strategy
    }
  },
  skewProtection: {
    checkForUpdateStrategy: 'ws'
  }
})
```

## File Structure

```
src/
├── module.ts                          # Main module entry, platform detection
├── kit.ts                             # Platform detection utilities
├── logger.ts                          # Build-time logger
├── utils/
│   └── version-manager.ts             # Asset versioning & storage logic
├── runtime/
│   ├── types.ts                       # TypeScript types
│   ├── shared/
│   │   ├── cookie.ts                  # Shared cookie utilities
│   │   └── logger.ts                  # Client-side logger
│   ├── app/
│   │   ├── components/
│   │   │   └── SkewNotification.vue   # Headless notification component
│   │   ├── composables/
│   │   │   ├── useSkewProtection.ts   # Main composable
│   │   │   ├── useSkewProtectionCookie.ts
│   │   │   └── fetchLatestManifest.ts
│   │   └── plugins/
│   │       ├── 0.skew-protection.ts   # Root plugin
│   │       ├── sw-track-user-modules.client.ts  # Service worker integration
│   │       ├── check-updates-sse.client.ts      # SSE update detection
│   │       └── check-updates-websocket.client.ts # WebSocket update detection
│   └── server/
│       ├── index.ts                   # Server exports
│       ├── imports/
│       │   ├── cookie.ts              # Server cookie utilities
│       │   └── utils.ts               # Server utilities
│       ├── middleware/
│       │   ├── set-skew-protection-cookie.ts  # Cookie middleware
│       │   └── vercel-skew.ts         # Vercel-specific middleware
│       └── routes/
│           └── _skew/
│               ├── sse.ts             # SSE endpoint
│               └── ws.ts              # WebSocket endpoint
sw/
└── sw.js                              # Service worker for module tracking
```

## Benefits of This Architecture

1. **Universal** - Works on any platform with any storage backend
2. **Simple** - No platform-specific code paths for asset serving
3. **Fast** - Assets served as static files, fully cacheable
4. **Intelligent** - Only notifies users when their session is affected
5. **Flexible** - Three update strategies for different use cases
6. **Compatible** - Integrates with Nuxt's native mechanisms
7. **Scalable** - Deduplication reduces storage costs
8. **Maintainable** - Single code path, well-organized structure
