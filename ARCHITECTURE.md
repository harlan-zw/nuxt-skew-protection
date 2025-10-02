# Nuxt Skew Protection - Simplified Architecture

## Overview

This module provides version skew protection for Nuxt applications with three platform-specific implementations:
1. **Cloudflare** - OpenNext-compatible pattern with deployment routing
2. **Vercel** - Uses Vercel's built-in skew protection
3. **Generic (unstorage-based)** - Works everywhere else, uses unstorage for version tracking

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              SIMPLIFIED ARCHITECTURE                 │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Build-Time (src/module.ts):                        │
│  ┌────────────────────────────────────────┐        │
│  │ 1. Detect platform (CF/Vercel/Generic) │        │
│  │ 2. Register platform middleware         │        │
│  │ 3. Register API endpoints               │        │
│  │ 4. Set up build hooks                   │        │
│  └────────────────────────────────────────┘        │
│                                                      │
│  Runtime - Client APIs:                             │
│  ┌────────────────────────────────────────┐        │
│  │ GET /_skew/status                   │        │
│  │  → Check if client version is outdated │        │
│  │  → Returns: outdated, clientVersion,   │        │
│  │     currentVersion                      │        │
│  └────────────────────────────────────────┘        │
│                                                      │
│  Runtime - Admin APIs:                              │
│  ┌────────────────────────────────────────┐        │
│  │ GET /_skew/debug                    │        │
│  │  → Show all deployment info             │        │
│  │  → Returns: provider, buildId, manifest│        │
│  └────────────────────────────────────────┘        │
│                                                      │
│  Runtime - Middleware:                              │
│  ┌────────────────────────────────────────┐        │
│  │ Cloudflare: /** → cloudflare-skew.ts   │        │
│  │  → Routes requests based on deployment │        │
│  │                                          │        │
│  │ Vercel: /** → vercel-skew.ts            │        │
│  │  → Sets Vercel deployment cookie        │        │
│  │                                          │        │
│  │ Generic: Uses standard middleware       │        │
│  │  → Version checking via API endpoints   │        │
│  └────────────────────────────────────────┘        │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Platform Implementations

All platform detection and setup is handled in `src/module.ts` - no separate provider classes needed.

### 1. Cloudflare (OpenNext pattern)

**When:** Auto-detected when `CF_WORKER_NAME`, `CF_PREVIEW_DOMAIN` and deployment ID exist

**How it works:**
1. **Build-time:** Creates asset manifest mapping file paths to deployment IDs
   ```json
   {
     "releases": [
       {
         "deploymentId": "dpl-abc123",
         "date": "2025-10-01T10:00:00Z",
         "buildId": "abc123",
         "versionId": "cdf6f9a0-...",
         "modules": ["/_nuxt/app.js", "/_nuxt/entry.js"]
       }
     ],
     "files": {
       "/_nuxt/app.abc123.js": "dpl-abc123",
       "/_nuxt/entry.abc123.js": "dpl-abc123"
     }
   }
   ```

2. **Runtime - Document requests:**
   - Bots: Always serve current version (ignore cookies)
   - Users: Serve current version and reset `skew-version` cookie (ignore old cookies)

3. **Runtime - Asset requests (`/_nuxt/*`):**
   - **With cookie:** Route to deployment from cookie (fast path)
   - **Without cookie (bots/crawlers):** Look up asset in manifest, route to correct deployment
   - **Not in manifest:** Try current version, then search all versions (fallback)

**Files:**
- `src/module.ts` - Platform detection and setup (lines 69-103)
- `src/runtime/server/middleware/cloudflare-skew.ts` - Runtime request routing with manifest lookup

**Environment Variables:**
- `CF_WORKER_NAME` - Worker name
- `CF_PREVIEW_DOMAIN` - Preview domain
- `NUXT_DEPLOYMENT_ID` or `NUXT_BUILD_ID` - Deployment identifier
- `CF_DEPLOYMENT_MAPPING` - JSON mapping of deployment IDs to version IDs

### 2. Vercel (native)

**When:** Auto-detected when `VERCEL_SKEW_PROTECTION_ENABLED=1` and `VERCEL_DEPLOYMENT_ID` exists

**How it works:**
1. Uses Vercel's native skew protection (no custom logic needed)
2. Sets `__vdpl` cookie with deployment ID on HTML requests
3. Vercel infrastructure handles the rest

**Files:**
- `src/module.ts` - Platform detection and setup (lines 69-111)
- `src/runtime/server/middleware/vercel-skew.ts` - Runtime cookie setting

**No storage needed** - Vercel handles everything

### 3. Generic (unstorage-based)

**When:** Default fallback for all other platforms (Netlify, self-hosted, etc.)

**How it works:**
1. Build-time: Copies assets to versioned directories in storage
2. Runtime: Serves versioned assets and tracks versions
3. Client: Checks `/_skew/status` to detect outdated version

**Files:**
- `src/module.ts` - Platform detection and setup
- Standard middleware files for document/API/asset handling

**Storage:**
- Uses unstorage (memory, filesystem, KV, etc.)
- Stores: `versions-manifest.json` and versioned assets

## API Endpoints

### GET `/_skew/status`
**Purpose:** Client-side version checking

**Response:**
```json
{
  "outdated": false,
  "clientVersion": "build-abc123",
  "currentVersion": "build-xyz789",
  "versionExists": true,
  "availableVersions": ["build-abc123", "build-xyz789"]
}
```

### GET `/_skew/debug`
**Purpose:** Admin debugging

**Response:**
```json
{
  "provider": "generic",
  "buildId": "build-abc123",
  "manifest": { /* versions manifest */ },
  "stats": {
    "availableVersions": ["build-abc123"],
    "currentVersion": "build-abc123",
    "totalVersions": 1
  }
}
```

## Key Design Decisions

### Asset Resolution Strategy (Cloudflare):

**Priority Order:**
1. **Cookie present** → Route directly (fast path, no manifest lookup needed)
2. **No cookie + manifest hit** → Route to deployment from manifest lookup
3. **Manifest miss** → Fallback: try current version, then search all versions

**Why this works:**
- ✅ **Users with cookies**: Fast routing, no manifest lookup
- ✅ **Bots with cached HTML**: Manifest lookup finds correct version for old assets
- ✅ **Graceful degradation**: Fallback search handles edge cases
- ✅ **No 404s**: Old assets remain accessible even weeks after deployment

### What We Simplified:
1. ✅ **No provider classes** - All platform detection logic is directly in `src/module.ts`
2. ✅ **Simple platform detection** - Auto-detects Cloudflare, Vercel, or uses Generic
3. ✅ **Platform-specific middleware** - Each platform only loads the middleware it needs
4. ✅ **Streamlined API** - Just `/_skew/status` and `/_skew/debug`
5. ✅ **Manifest-based routing** - Assets can be found without cookies (handles bots/crawlers)

### What We Support:
1. ✅ Cloudflare Workers (OpenNext pattern with manifest-based asset routing)
2. ✅ Vercel (native skew protection)
3. ✅ Generic platforms via unstorage (Netlify, self-hosted, etc.)
4. ✅ `/_skew/status` (client version checking)
5. ✅ `/_skew/debug` (admin debugging)
6. ✅ Bot/crawler support (cached HTML assets work via manifest lookup)

## Flow Diagrams

### Cloudflare Flow

```
┌─────────────┐
│  Build Time │
└──────┬──────┘
       │
       ├─► Detect CF_WORKER_NAME, CF_PREVIEW_DOMAIN
       ├─► Generate asset manifest: { releases: [], files: {} }
       ├─► Map every /_nuxt/* file to its deployment ID
       ├─► Register cloudflare-skew middleware
       └─► Set deployment ID

┌─────────────┐
│   Runtime   │
└──────┬──────┘
       │
       ├─► Document requests (HTML):
       │   ├─► Bots: Current version (ignore cookies)
       │   └─► Users: Current version + reset cookie
       │
       ├─► Asset requests (/_nuxt/*):
       │   ├─► With cookie: Route to deployment from cookie (fast)
       │   ├─► Without cookie: Look up in manifest → route to correct deployment
       │   └─► Not in manifest: Try current → search all versions
       │
       └─► Client checks /_skew/status

```

### Vercel Flow

```
┌─────────────┐
│  Build Time │
└──────┬──────┘
       │
       ├─► Detect VERCEL_SKEW_PROTECTION_ENABLED
       └─► Register vercel-skew middleware

┌─────────────┐
│   Runtime   │
└──────┬──────┘
       │
       ├─► Middleware sets __vdpl cookie
       ├─► Vercel routes requests to correct deployment
       └─► Client checks /_skew/status (optional)
```

### Generic Flow

```
┌─────────────┐
│  Build Time │
└──────┬──────┘
       │
       ├─► Copy assets to versioned directories
       ├─► Create versions-manifest.json
       └─► Store in unstorage

┌─────────────┐
│   Runtime   │
└──────┬──────┘
       │
       ├─► Standard middleware handles requests
       ├─► Serve versioned assets from storage
       └─► Client checks /_skew/status periodically
```

## Configuration

Minimal configuration required:

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-skew-protection'],

  skewProtection: {
    // Optional: configure storage
    storage: {
      driver: 'fs', // or 'memory', 'cloudflare-kv', etc.
      base: './.versions'
    },

    // Optional: retention settings
    retentionDays: 7,
    maxNumberOfVersions: 10,

    // Optional: notification strategy
    notificationStrategy: 'modal', // or 'toast', 'redirect', 'silent'
  }
})
```

### Vercel-specific:
```bash
# Enable Vercel native skew protection
VERCEL_SKEW_PROTECTION_ENABLED=1
# Vercel sets VERCEL_DEPLOYMENT_ID automatically
```

## Benefits of Simplified Architecture

1. **Easier to understand** - All platform logic in one file (`src/module.ts`)
2. **Less code** - No provider abstraction layer, direct platform detection
3. **Better tree-shaking** - Only load middleware for the detected platform
4. **Simpler APIs** - Only 2 endpoints (status + debug)
5. **Three platforms supported** - Cloudflare, Vercel, and Generic (unstorage)
