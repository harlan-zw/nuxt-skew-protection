# Cloudflare Skew Protection

This module supports Cloudflare Workers using the **OpenNext pattern** - a proven approach for handling version skew in serverless deployments.

## How It Works

Based on: [OpenNext Cloudflare Implementation](https://github.com/opennextjs/opennextjs-cloudflare)

### Overview

1. **Build Time**: Generate deployment mapping that links deployment IDs to worker version IDs
2. **Deploy Time**: Update `CF_DEPLOYMENT_MAPPING` environment variable with the mapping
3. **Runtime**: Middleware routes requests to the correct version using Cloudflare Preview URLs

### Deployment Mapping

The mapping is stored in the `CF_DEPLOYMENT_MAPPING` environment variable:

```json
{
  "dpl-abc123": "current",
  "dpl-xyz789": "a1b2c3d4-1234-5678-abcd-ef0123456789",
  "dpl-old456": "b2c3d4e5-2345-6789-bcde-f01234567890"
}
```

- **Latest deployment**: Uses `"current"` placeholder (replaced with actual version ID on next deploy)
- **Previous deployments**: Mapped to specific worker version IDs
- **Old deployments**: Removed when versions are cleaned up

## Setup

### Required Environment Variables

```bash
# Required for detection
CF_WORKER_NAME=my-nuxt-app          # Your worker name
CF_PREVIEW_DOMAIN=my-account        # Your Cloudflare subdomain

# Required at deploy time (updated automatically)
CF_DEPLOYMENT_MAPPING={}            # Deployment mapping JSON

# Build identifier
NUXT_DEPLOYMENT_ID=dpl-abc123       # Unique deployment ID
# or
NUXT_BUILD_ID=build-abc123          # Falls back to build ID
```

### Optional Variables

```bash
# For API access (if you need to list versions)
CF_ACCOUNT_ID=your-account-id
CF_WORKERS_SCRIPTS_API_TOKEN=your-api-token
```

## Request Flow

### Normal Request (Latest Version)

```
Client Request
  ↓
  https://myapp.com/page
  ↓
  [Middleware checks: no x-deployment-id header]
  ↓
  Serves current version
```

### Versioned Request (Old Client)

```
Old Client Request (with deployment ID)
  ↓
  https://myapp.com/page
  Headers: x-deployment-id: dpl-old456
  ↓
  [Middleware checks CF_DEPLOYMENT_MAPPING]
  ↓
  Finds version: b2c3d4e5-2345-6789-bcde-f01234567890
  ↓
  Constructs preview URL:
  https://b2c3d4e5-my-nuxt-app.my-account.workers.dev/page
  ↓
  Forwards request to versioned worker
  ↓
  Returns response to client
```

## Deployment Process

### 1. Generate Deployment Mapping

During build, generate a new deployment mapping:

```typescript
import { updateCloudflareDeploymentMapping } from 'nuxt-skew-protection/utils'

// Get existing mapping from environment
const existingMapping = JSON.parse(process.env.CF_DEPLOYMENT_MAPPING || '{}')

// Get available worker versions (from Cloudflare API)
const versions = await listWorkerVersions(workerName, {
  client,
  accountId,
  maxVersions: 10,
  maxAgeDays: 7
})

// Update mapping for new deployment
const newMapping = updateCloudflareDeploymentMapping(
  existingMapping,
  versions,
  'dpl-new789' // Your new deployment ID
)

console.log('New CF_DEPLOYMENT_MAPPING:', JSON.stringify(newMapping))
```

### 2. Deploy with Updated Mapping

```bash
# Deploy with updated environment variable
wrangler deploy \
  --name my-nuxt-app \
  --env production \
  --var NUXT_DEPLOYMENT_ID:dpl-new789 \
  --var CF_DEPLOYMENT_MAPPING:'{"dpl-new789":"current","dpl-abc123":"a1b2c3d4-..."}'
```

### 3. Verify Deployment

```bash
# Check status endpoint
curl https://myapp.com/_skew/debug

# Test old client request
curl -H "x-deployment-id: dpl-abc123" https://myapp.com/
```

## Preview URL Format

Cloudflare Preview URLs follow this pattern:

```
https://{version-domain}-{worker-name}.{preview-domain}.workers.dev
```

Example:
- Worker name: `my-nuxt-app`
- Preview domain: `my-account`
- Version ID: `a1b2c3d4-1234-5678-abcd-ef0123456789`
- Version domain: `a1b2c3d4` (first segment)

**Preview URL:**
```
https://a1b2c3d4-my-nuxt-app.my-account.workers.dev
```

## Configuration

### Nuxt Config

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-skew-protection'],

  skewProtection: {
    // Optional: customize retention
    retentionDays: 7,
    maxNumberOfVersions: 10,

    // Debug mode
    debug: true,
  },

  runtimeConfig: {
    // These are set automatically from env vars
    app: {
      buildId: process.env.NUXT_DEPLOYMENT_ID || process.env.NUXT_BUILD_ID
    }
  }
})
```

## Testing

### Test Cloudflare Setup

```bash
cd test/fixtures/cloudflare
pnpm install
```

### Environment Setup

```bash
# Copy template
cp .env.example .env.local

# Configure
CF_WORKER_NAME=nuxt-skew-test
CF_PREVIEW_DOMAIN=your-subdomain
CF_ACCOUNT_ID=your-account-id
CF_WORKERS_SCRIPTS_API_TOKEN=your-api-token
NUXT_DEPLOYMENT_ID=dpl-test-001
```

### Deploy Test

```bash
pnpm build
wrangler deploy
```

### Test Version Routing

```bash
# Normal request (current version)
curl https://nuxt-skew-test.your-domain.com/

# Request old version
curl -H "x-deployment-id: dpl-old" https://nuxt-skew-test.your-domain.com/

# Asset request with version
curl https://nuxt-skew-test.your-domain.com/_nuxt/app.js?dpl=dpl-old
```

## Differences from Generic Provider

| Feature | Cloudflare Provider | Generic Provider |
|---------|-------------------|------------------|
| **Storage** | No storage needed | Requires unstorage |
| **Routing** | Preview URLs | `/_versions/**` paths |
| **Setup** | Env vars only | Storage + env vars |
| **Versioning** | Worker versions | Build ID |
| **API** | Cloudflare API | Storage API |

## Best Practices

1. **Unique Deployment IDs**: Use timestamps or git commit SHAs
   ```bash
   NUXT_DEPLOYMENT_ID="dpl-$(date +%s)-$(git rev-parse --short HEAD)"
   ```

2. **Version Cleanup**: Limit old versions to reduce mapping size
   ```typescript
   maxNumberOfVersions: 10
   retentionDays: 7
   ```

3. **Monitor Deployments**: Check `/_skew/debug` after deploys
   ```bash
   curl https://myapp.com/_skew/debug | jq
   ```

4. **CI/CD Integration**: Automate deployment mapping updates
   ```yaml
   # .github/workflows/deploy.yml
   - name: Update deployment mapping
     run: |
       NEW_MAPPING=$(node scripts/update-cf-mapping.js)
       wrangler deploy --var CF_DEPLOYMENT_MAPPING:"$NEW_MAPPING"
   ```

## Troubleshooting

### "Deployment ID collision detected"

**Cause**: Deployment ID has been used before

**Solution**: Generate a new unique deployment ID
```bash
export NUXT_DEPLOYMENT_ID="dpl-$(date +%s)"
```

### Requests not routing to old versions

**Cause**: `CF_DEPLOYMENT_MAPPING` not set or invalid

**Solution**: Check environment variable
```bash
wrangler secret get CF_DEPLOYMENT_MAPPING
```

### Preview URL 404 errors

**Cause**: Worker version doesn't exist or preview URLs disabled

**Solution**:
1. Enable preview URLs in Cloudflare dashboard
2. Verify version exists: `wrangler versions list`

### Middleware not running

**Cause**: Only active on custom domains

**Solution**: Test on your production domain, not `*.workers.dev`

## OpenNext Compatibility

This implementation follows the **OpenNext Cloudflare pattern**:

- ✅ Same deployment routing approach
- ✅ Same preview URL pattern
- ✅ Compatible request routing logic
- ✅ Environment-based configuration

The module automatically detects Cloudflare environments and enables the appropriate middleware.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full architecture details.
