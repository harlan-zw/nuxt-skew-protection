# Nuxt Skew Protection

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

## Why Nuxt Skew Protection?

Congrats you shipped that latest release! Turns out many of your users are going to be using the previous version of your app
for hours or even days after you deployed the new version.

Finally fixed that SEO issue? Great, but crawlers will often hit your site and request build chunks that no longer exist, leading
to 500 errors and broken indexes.

Unfortunately, you've just been "skewed". Skew is the version difference between what your users are running and what is currently deployed.

While Nuxt helps us by hard-reloading on navigation when it detects a new release, it's often not enough to ensure a smooth experience for all users
and crawlers. Just check out one of Nuxt's top commented [issues](https://github.com/nuxt/nuxt/issues/29624).

## 🚀 Features

- 🏗️ **Long-lived Nuxt Assets** - Old build assets remain accessible after new deployments for set periods.
- **Instantly Adopted Releases**
  - Use SSE in supported environments for updates notify clients of new deployments immediately
  - Using workers? No problem. Skew protection is enabled through [Preview Environments](https://vercel.com/docs/concepts/deployments/preview-deployments) and [Vercel Skew Protection](https://vercel.com/docs/concepts/limits/skew-protection).
  -
- **Intelligent User Notifications**
  - Based on the page the user is on and if a chunk they're using is updated, it will conditionally notify them.
  - Headless UI component with full Nuxt UI integration.

## 📦 Installation

```bash
npm install nuxt-skew-protection
# or
yarn add nuxt-skew-protection
# or
pnpm add nuxt-skew-protection
```

## 🏁 Quick Start

1. **Add the module to your Nuxt config:**

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-skew-protection'],
  skewProtection: {
    // Basic configuration
    storage: {
      driver: 'redis',
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
    },

    // Production settings
    debug: false,
    retentionDays: 7,
    maxNumberOfVersions: 10,
  }
})
```

2. **Set environment variables:**

```bash
# Storage configuration
REDIS_HOST=your-redis-host
REDIS_PORT=6379

# Optional: Custom build ID
NUXT_BUILD_ID=your-unique-build-id
```

3. **Deploy and monitor:**

```bash
# Check status
curl https://your-app.com/_skew/status
```

## 🔧 Configuration

### Basic Configuration

```typescript
export default defineNuxtConfig({
  skewProtection: {
    // Storage backend (required for production)
    storage: {
      driver: 'redis',
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      password: process.env.REDIS_PASSWORD,
    },

    // Version management
    retentionDays: 7, // Keep versions for 7 days
    maxNumberOfVersions: 10, // Keep max 10 versions

    // Client behavior
    notificationStrategy: 'modal', // How to notify clients of updates
    checkOutdatedBuildInterval: 30000, // Check for updates every 30s

    // Debug mode
    debug: false,
  }
})
```

### Storage Backends

#### Redis (Recommended for production)
```typescript
export default defineNuxtConfig({
  modules: ['nuxt-skew-protection'],
  skewProtection: {
    storage: {
      driver: 'redis',
      host: process.env.REDIS_HOST || 'localhost',
      port: Number.parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      keyPrefix: 'skew:',
      ttl: 7 * 24 * 60 * 60, // 7 days
    },
  },
})
```

#### AWS S3
```typescript
export default defineNuxtConfig({
  modules: ['nuxt-skew-protection'],
  skewProtection: {
    storage: {
      driver: 's3',
      bucket: process.env.S3_BUCKET || 'my-bucket',
      region: process.env.AWS_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  },
})
```

#### Cloudflare KV
```typescript
export default defineNuxtConfig({
  modules: ['nuxt-skew-protection'],
  skewProtection: {
    storage: {
      driver: 'cloudflare-kv',
      accountId: process.env.CF_ACCOUNT_ID || '',
      namespaceId: process.env.CF_KV_NAMESPACE_ID || '',
      apiToken: process.env.CF_API_TOKEN,
    },
  },
})
```

#### PostgreSQL/MySQL
```typescript
export default defineNuxtConfig({
  modules: ['nuxt-skew-protection'],
  skewProtection: {
    storage: {
      driver: 'database',
      connectionString: process.env.DATABASE_URL || '',
      tableName: 'skew_protection_cache',
    },
  },
})
```

### Environment-Specific Configurations

```typescript
// utils/skew-config.ts
export function getSkewConfig(env: string) {
  const configs = {
    development: {
      debug: true,
      retentionDays: 1,
      maxNumberOfVersions: 5,
      notificationStrategy: 'modal',
      enableDeploymentMapping: false,
    },

    staging: {
      debug: true,
      retentionDays: 3,
      maxNumberOfVersions: 10,
      notificationStrategy: 'toast',
      enableDeploymentMapping: true,
    },

    production: {
      debug: false,
      retentionDays: 7,
      maxNumberOfVersions: 20,
      notificationStrategy: 'silent',
      enableDeploymentMapping: true,
    }
  }

  return configs[env] || configs.production
}

// nuxt.config.ts
export default defineNuxtConfig({
  skewProtection: {
    storage: { /* your storage config */ },
    ...getSkewConfig(process.env.NODE_ENV || 'production')
  }
})
```

## 🎯 Usage

### Deployment ID Sources

The module checks for deployment IDs in this order:

1. **HTTP Header**: `x-deployment-id`
2. **Query Parameter**: `dpl`
3. **Cookie**: `skew-version`

```typescript
// Example: Request specific deployment
fetch('/api/data', {
  headers: {
    'x-deployment-id': 'deployment-abc123'
  }
})

// Or via query parameter
fetch('/api/data?dpl=deployment-abc123')
```

### Health Monitoring

```typescript
// Basic health check
const health = await $fetch('/_skew/health')
console.log(health.status) // 'healthy', 'degraded', or 'unhealthy'

// Detailed health with metrics
const detailed = await $fetch('/_skew/health?detailed=true')
console.log(detailed.metrics) // Performance metrics
console.log(detailed.checks) // Individual health checks
```

### Deployment Mapping

```typescript
// Get current deployment mapping
const mapping = await $fetch('/_skew/deployment-mapping?action=get')

// Get deployment mapping status
const status = await $fetch('/_skew/deployment-mapping?action=status')

// Resolve specific deployment ID
const result = await $fetch('/_skew/deployment-mapping?action=resolve&deploymentId=abc123')
```

## 🚀 Deployment Strategies

### Rolling Deployment
```bash
# Automatic rolling deployment with health checks
export NUXT_BUILD_ID="v$(date +%s)"
./scripts/deploy.sh

# Monitor deployment
watch curl -s https://your-app.com/_skew/health
```

### Blue-Green Deployment
```bash
# Deploy to green environment
export NUXT_BUILD_ID="green-$(date +%s)"
export DEPLOYMENT_METHOD="docker"
export CONTAINER_NAME="app-green"
./scripts/deploy.sh

# Switch traffic (update load balancer)
# Cleanup old blue environment
```

### Canary Deployment
```bash
# Deploy canary version
export NUXT_BUILD_ID="canary-$(date +%s)"
./scripts/deploy.sh

# Route subset of traffic to canary
# Monitor metrics and gradually increase traffic
```

## 📊 Monitoring

### Health Check Endpoints

```bash
# Basic health check (for load balancers)
curl https://your-app.com/_skew/health

# Detailed health check (for monitoring)
curl https://your-app.com/_skew/health?detailed=true

# Deployment mapping status
curl https://your-app.com/_skew/deployment-mapping?action=status
```

### Performance Metrics

```typescript
// Available metrics
interface SkewProtectionMetrics {
  totalRequests: number
  versionedRequests: number
  outdatedClientDetections: number
  fallbackRequests: number
  errorCount: number
  averageResponseTime: number
  storageOperations: number
  deploymentMappingLookups: number
}
```

### Load Testing

```bash
# Run built-in load test
./scripts/load-test.js

# Custom load test parameters
CONCURRENCY=20 DURATION=60000 ./scripts/load-test.js

# Test specific scenarios
TEST_URL=https://staging.example.com ./scripts/load-test.js
```

## 🔒 Security

### Rate Limiting

Built-in rate limiting protects against abuse:

- **IP-based**: 60 requests/minute per IP
- **API-based**: 100 requests/minute per API key
- **User-based**: 30 requests/minute per user

### Input Validation

All inputs are validated and sanitized:

```typescript
// Example: Safe deployment ID validation
const deploymentIdSchema = {
  fields: {
    deploymentId: {
      type: 'string',
      required: true,
      pattern: /^[\w\-]{1,64}$/,
      sanitize: sanitizers.alphanumericOnly
    }
  }
}
```

## 🧪 Testing

### Run Tests

```bash
# Unit tests
npm run test

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# Load tests
npm run test:load

# All tests
npm run test:all
```

### Custom Test Environment

```typescript
// test/setup.ts
import { setup } from '@nuxt/test-utils'

await setup({
  configFile: 'test/nuxt.config.ts',
  server: true,
  skewProtection: {
    storage: {
      driver: 'memory' // Use in-memory storage for tests
    },
    debug: true
  }
})
```

## 🛠️ Development

### Local Development

```bash
# Clone and install
git clone https://github.com/your-org/nuxt-skew-protection
cd nuxt-skew-protection
npm install

# Start development server
npm run dev

# Run tests in watch mode
npm run test:watch
```

### Build

```bash
# Build the module
npm run build

# Build with type checking
npm run build:check

# Prepare for publishing
npm run prepare
```

## 📚 Advanced Usage

### Custom Storage Driver

```typescript
// Create custom storage driver
import { defineDriver } from 'unstorage'

const myCustomDriver = defineDriver(options => ({
  async getItem(key) { /* implementation */ },
  async setItem(key, value) { /* implementation */ },
  async removeItem(key) { /* implementation */ },
  async getKeys() { /* implementation */ },
  async clear() { /* implementation */ }
}))

// Use in configuration
export default defineNuxtConfig({
  skewProtection: {
    storage: {
      driver: myCustomDriver,
      // ... driver options
    }
  }
})
```

### Custom Hooks

```typescript
// server/plugins/skew-hooks.ts
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('skew-protection:outdated-client', async (data) => {
    // Custom handling for outdated clients
    console.log('Outdated client detected:', data)

    // Send to analytics
    await sendToAnalytics('outdated_client', data)

    // Trigger notification
    await notifyOps('Client version mismatch detected', data)
  })
})
```

### Graceful Degradation

```typescript
// Custom degradation handling
import { DegradationLevel, setDegradationLevel } from 'nuxt-skew-protection/runtime/server/utils/graceful-degradation'

// In your monitoring system
if (errorRate > 0.5) {
  setDegradationLevel(DegradationLevel.EMERGENCY, 'High error rate detected')
}
```

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

```bash
# Fork and clone the repository
git clone https://github.com/your-username/nuxt-skew-protection
cd nuxt-skew-protection

# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build
```

## 📄 License

[MIT License](LICENSE.md) - see the [LICENSE.md](LICENSE.md) file for details.

## 🙏 Acknowledgments

- Inspired by [Open Next](https://open-next.js.org/) skew protection implementation
- Built for the [Nuxt](https://nuxt.com/) ecosystem
- Designed for enterprise production environments

---

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/nuxt-skew-protection/latest.svg?style=flat&colorA=18181B&colorB=28CF8D
[npm-version-href]: https://npmjs.com/package/nuxt-skew-protection

[npm-downloads-src]: https://img.shields.io/npm/dm/nuxt-skew-protection.svg?style=flat&colorA=18181B&colorB=28CF8D
[npm-downloads-href]: https://npmjs.com/package/nuxt-skew-protection

[license-src]: https://img.shields.io/github/license/your-org/nuxt-skew-protection.svg?style=flat&colorA=18181B&colorB=28CF8D
[license-href]: https://github.com/your-org/nuxt-skew-protection/blob/main/LICENSE.md

[nuxt-src]: https://img.shields.io/badge/Nuxt-18181B?logo=nuxt.js
[nuxt-href]: https://nuxt.com
