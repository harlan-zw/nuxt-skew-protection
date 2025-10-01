# Cloudflare Workers Real Deployment Test

This directory contains the setup for testing our skew protection implementation with real Cloudflare Workers.

## Prerequisites

1. **Cloudflare Account**
   - Sign up at https://cloudflare.com
   - Get your Account ID from the dashboard

2. **Cloudflare API Token**
   - Create API token with `Workers Scripts:Edit` permissions
   - Save the token securely

3. **Wrangler CLI**
   ```bash
   npm install -g wrangler
   wrangler login
   ```

## Environment Setup

Copy the environment template and fill in your values:

```bash
cp .env.example .env.local
```

Required environment variables:
```bash
# Cloudflare Configuration
CF_ACCOUNT_ID=your_account_id_here
CF_WORKERS_SCRIPTS_API_TOKEN=your_api_token_here
CF_WORKER_NAME=nuxt-skew-test
CF_PREVIEW_DOMAIN=your_subdomain  # e.g., my-account

# Deployment Mapping (will be updated during test)
CF_DEPLOYMENT_MAPPING={}

# Nuxt Configuration
NUXT_DEPLOYMENT_ID=dpl-test-initial
```

## Test Scenarios

### 1. Basic Deployment Test
```bash
npm run test:cloudflare:basic
```
- Deploys a simple Nuxt app with our skew protection
- Verifies provider detection and setup
- Tests normal request flow

### 2. Version Routing Test
```bash
npm run test:cloudflare:routing
```
- Deploys multiple versions of the app
- Tests deployment mapping updates
- Validates request routing to different versions

### 3. Performance Comparison
```bash
npm run test:cloudflare:performance
```
- Compares our implementation vs OpenNext
- Measures request latency and throughput
- Tests under load conditions

## Manual Testing Steps

### Step 1: Deploy Initial Version
```bash
cd test/cloudflare/app
wrangler deploy --name nuxt-skew-test
```

### Step 2: Update Deployment Mapping
```bash
# Get worker versions
wrangler versions list --name nuxt-skew-test

# Update CF_DEPLOYMENT_MAPPING with version info
# Format: {"deployment-id": "version-id"}
```

### Step 3: Test Request Routing
```bash
# Test normal request
curl https://nuxt-skew-test.your-subdomain.workers.dev/

# Test with deployment ID header
curl -H "x-deployment-id: dpl-test-old" https://nuxt-skew-test.your-subdomain.workers.dev/

# Test with query parameter
curl https://nuxt-skew-test.your-subdomain.workers.dev/?dpl=dpl-test-old
```

### Step 4: Verify Preview URL Routing
Monitor Cloudflare Workers logs to see:
- Request interception by our middleware
- Preview URL generation
- Request forwarding to versioned workers

## Expected Results

✅ **Provider Detection**: Cloudflare provider should be automatically detected
✅ **Environment Validation**: All required env vars should be present
✅ **Request Routing**: Requests with deployment IDs should be forwarded
✅ **Domain Filtering**: Only custom domains should trigger routing
✅ **Error Handling**: Invalid deployment IDs should fallback gracefully

## Troubleshooting

### Common Issues

1. **"Provider not enabled"**
   - Check all environment variables are set
   - Verify CF_ACCOUNT_ID format
   - Ensure CF_WORKER_NAME matches deployed worker

2. **"Deployment mapping not found"**
   - Check CF_DEPLOYMENT_MAPPING format (must be valid JSON)
   - Verify deployment IDs exist in mapping
   - Update mapping after each deployment

3. **"Request forwarding failed"**
   - Check preview domain configuration
   - Verify worker versions exist
   - Check Cloudflare API token permissions

### Debug Mode

Enable debug logging:
```bash
export NUXT_SKEW_PROTECTION_DEBUG=true
```

This will log:
- Provider detection results
- Deployment mapping parsing
- Request routing decisions
- Preview URL generation
- Fetch forwarding attempts

## Comparison with OpenNext

Our implementation should match OpenNext's behavior:
- ✅ Same environment variable usage
- ✅ Same deployment mapping format
- ✅ Same preview URL pattern
- ✅ Same request forwarding logic
- ✅ Same domain filtering rules

Plus additional benefits:
- ✅ Universal fallback for non-Cloudflare platforms
- ✅ Better error handling and recovery
- ✅ Comprehensive test coverage
- ✅ Simplified configuration
