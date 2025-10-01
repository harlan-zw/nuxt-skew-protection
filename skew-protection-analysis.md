# Nuxt Skew Protection Module - Implementation Analysis

## What is Skew Protection?

Skew protection is a deployment strategy that maintains version consistency between client and server components during web application updates. As described by Malte Ubl: "When client and server deployments aren't perfectly in sync... calls between them can lead to unexpected behavior."

### Core Problems Solved
- Runtime errors from API contract changes during deployments
- Asset loading failures when static files are updated
- User session disruption during updates
- Support for high-frequency deployments

## Framework-Level Implementation Strategy (Client-Focused)

### Core Approach: Version Mismatch Notification

Instead of maintaining backend parity, we focus on **detecting version mismatches and notifying the client** to refresh/reload when a new version is available.

### 1. Static Asset Versioning & Manifest Management

#### Build-time Asset Organization
```
public/
├── _versions/
│   ├── v1-abc123/
│   │   ├── _nuxt/
│   │   └── assets/
│   └── v2-def456/
│       ├── _nuxt/
│       └── assets/
└── versions-manifest.json
```

#### Expanded Implementation Details

**Build Hook Integration:**
```javascript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-skew-protection'],
  skewProtection: {
    storage: {
      // User-provided unstorage configuration
      driver: 'redis', // or 'fs', 's3', 'cloudflare-kv', etc.
      base: 'skew-protection',
      // Additional driver-specific options
      host: 'localhost',
      port: 6379
    },
    retentionDays: 60,
    versionStrategy: 'git-commit' // or 'timestamp', 'uuid'
  }
})
```

**Build Process:**
1. Generate unique version ID (git commit hash, timestamp, or UUID)
2. Copy all built assets to versioned directories
3. Create/update manifest with version metadata:
   ```json
   {
     "current": "v2-def456",
     "versions": {
       "v1-abc123": {
         "timestamp": "2025-01-15T10:30:00Z",
         "expires": "2025-03-16T10:30:00Z",
         "assets": ["_nuxt/app-123.js", "_nuxt/app-123.css"]
       },
       "v2-def456": {
         "timestamp": "2025-01-16T14:20:00Z",
         "expires": "2025-03-17T14:20:00Z",
         "assets": ["_nuxt/app-456.js", "_nuxt/app-456.css"]
       }
     }
   }
   ```
4. Store manifest in user-configured unstorage (Redis, S3, etc.)
5. Clean up expired versions (> 60 days)

### 2. Client Version Tracking & Notification System

#### Leveraging Nuxt's Built-in Build Checking

**Use Existing `checkOutdatedBuildInterval` System:**
```javascript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-skew-protection'],
  experimental: {
    appManifest: true // Required for build checking
  },
  skewProtection: {
    // Lower the default 60min interval for faster detection
    checkOutdatedBuildInterval: 30000, // 30 seconds
    storage: {
      driver: 'redis',
      base: 'skew-protection',
      host: 'localhost',
      port: 6379
    },
    retentionDays: 60,
    notificationStrategy: 'modal' // 'modal' | 'toast' | 'redirect' | 'silent'
  }
})
```

**Enhanced Client Plugin Hook:**
```javascript
// Client plugin
export default defineNuxtPlugin(() => {
  const currentVersion = useCookie('skew-version', {
    default: () => getCurrentVersionFromMeta()
  })

  // Hook into Nuxt's existing app:manifest:update event
  nuxtApp.hook('app:manifest:update', async (manifest) => {
    const newBuildId = manifest.id
    const currentBuildId = currentVersion.value

    if (newBuildId !== currentBuildId) {
      // New version detected via Nuxt's built-in system
      await handleVersionMismatch(newBuildId, currentBuildId)
    }
  })

  // Also check the /_nuxt/builds/latest.json periodically if needed
  const checkLatestBuild = async () => {
    try {
      const latest = await $fetch('/_nuxt/builds/latest.json')
      if (latest.id !== currentVersion.value) {
        await handleVersionMismatch(latest.id, currentVersion.value)
      }
    }
    catch (error) {
      console.warn('Failed to check for updates:', error)
    }
  }

  // Optional: Additional polling for critical apps
  // const checkInterval = setInterval(checkLatestBuild, 10000) // 10 seconds
  // onBeforeUnmount(() => clearInterval(checkInterval))
})
```

#### Advantages of Using Nuxt's Built-in System

**Why This Approach is Superior:**
- **Zero Additional Infrastructure**: No need to build custom version endpoints
- **Already Optimized**: Nuxt's system is battle-tested and efficient
- **Consistent Build IDs**: Uses the same UUID format across the app
- **Built-in Caching**: The `/_nuxt/builds/latest.json` endpoint is already optimized
- **Configurable Intervals**: Easy to adjust checking frequency via `checkOutdatedBuildInterval`
- **Event-Driven**: React to actual build changes rather than polling blindly

**Build Integration Points:**
```javascript
// The module can hook into Nuxt's build process to:
// 1. Copy assets to versioned directories using the same build ID
// 2. Store the build manifest in unstorage alongside the build ID
// 3. Clean up old versions when new builds are detected

// Build hook example:
export default defineNuxtModule({
  setup(options, nuxt) {
    nuxt.hook('build:done', async () => {
      const buildId = nuxt.options.app.buildId // Same ID used by /_nuxt/builds/latest.json
      await copyAssetsToVersionedDirectory(buildId)
      await updateStorageManifest(buildId)
      await cleanupOldVersions()
    })
  }
})
```

**Server Middleware for Asset Resolution:**
```javascript
// middleware/skew-protection.ts
export default defineEventHandler(async (event) => {
  const url = getRouterParam(event, 'path')

  // Handle versioned asset requests
  if (url.startsWith('/_versions/')) {
    const versionFromCookie = getCookie(event, 'skew-version')
    const requestedPath = url.replace('/_versions/', '')

    // Try to serve from local filesystem first
    const localPath = `public/_versions/${requestedPath}`
    if (await fileExists(localPath)) {
      return sendStream(event, createReadStream(localPath))
    }

    // Fallback to unstorage lookup
    const storage = useStorage('skew-protection') // User-configured
    const assetBuffer = await storage.getItemRaw(requestedPath)

    if (assetBuffer) {
      return assetBuffer
    }

    // Asset not found, redirect to current version
    const manifest = await storage.getItem('versions-manifest.json')
    const currentVersion = manifest.current
    const fallbackPath = url.replace(/v\d+-[^/]+/, currentVersion)

    return sendRedirect(event, fallbackPath)
  }
})
```

#### Version Mismatch Event System

**Client Notification Options:**
```javascript
// composables/useVersionNotification.ts
export function useVersionNotification() {
  const showUpdateModal = () => {
    // Show elegant modal with "Update Available" message
    // Options: "Refresh Now" or "Continue (dismiss)"
  }

  const forceRefresh = () => {
    // Clear all caches and hard reload
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach(registration => registration.unregister())
      })
    }
    window.location.reload()
  }

  const silentUpdate = () => {
    // Preload new version assets in background
    // Update cookie to new version
    // Show subtle notification
  }
}
```

### 3. Unstorage Integration Requirements

#### User Configuration Options
```typescript
interface SkewProtectionConfig {
  storage: {
    driver: 'redis' | 'fs' | 's3' | 'cloudflare-kv' | 'memory'
    base?: string
    [key: string]: any // Driver-specific options
  }
  retentionDays?: number
  checkInterval?: number
  notificationStrategy?: 'modal' | 'toast' | 'redirect' | 'silent'
  fallbackBehavior?: 'current' | 'latest' | 'error'
}
```

#### Storage Operations
- **Write**: Store versioned assets and manifest during build
- **Read**: Retrieve assets when not found locally
- **Cleanup**: Remove expired versions based on retention policy
- **Lookup**: Fast version checking for client polling

### Implementation Phases

#### Phase 1: Core Version Detection
- Build-time version generation and asset copying
- Basic client version tracking with cookies
- Simple version mismatch detection

#### Phase 2: Storage Integration
- Unstorage configuration and integration
- Asset fallback middleware
- Automated cleanup processes

#### Phase 3: Enhanced UX
- Elegant notification system
- Background asset preloading
- Analytics and monitoring

### Technical Challenges & Solutions

- **Storage Performance**: Use CDN/edge caching for unstorage reads
- **Asset Size**: Implement asset compression and chunking
- **Network Reliability**: Graceful degradation when storage unavailable
- **Cache Busting**: Ensure proper cache headers for versioned assets

### Success Metrics

- Zero asset loading failures during deployments
- Improved user notification of updates
- Reduced support tickets related to "app not working"
- Faster deployment cycles with confidence
- Simple configuration and setup for developers
