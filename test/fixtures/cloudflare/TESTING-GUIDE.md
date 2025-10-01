# 🛡️ Cloudflare Workers Real Deployment Testing Guide

This guide walks you through testing our Nuxt Skew Protection implementation with real Cloudflare Workers deployment.

## 🚀 Quick Start

```bash
cd test/fixtures/cloudflare

# 1. Setup environment
./scripts/setup.sh

# 2. Configure your credentials
cp .env.example .env.local
# Edit .env.local with your Cloudflare details

# 3. Deploy and test
./scripts/deploy.sh
./scripts/test.sh
./scripts/performance.sh
```

## 📋 Prerequisites Checklist

- [ ] **Cloudflare Account** with Workers enabled
- [ ] **API Token** with `Workers Scripts:Edit` permissions
- [ ] **Custom Domain** (optional, for full testing)
- [ ] **Wrangler CLI** installed and authenticated
- [ ] **Node.js 18+** installed

## 🔧 Detailed Setup

### Step 1: Environment Configuration

1. **Get your Cloudflare Account ID:**
   - Visit [Cloudflare Dashboard](https://dash.cloudflare.com)
   - Copy Account ID from the right sidebar

2. **Create API Token:**
   - Go to [API Tokens](https://dash.cloudflare.com/profile/api-tokens)
   - Create token with `Workers Scripts:Edit` permission
   - Copy the token

3. **Configure environment:**
   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local`:
   ```bash
   CF_ACCOUNT_ID=your_account_id_here
   CF_WORKERS_SCRIPTS_API_TOKEN=your_api_token_here
   CF_WORKER_NAME=nuxt-skew-test
   CF_PREVIEW_DOMAIN=your_subdomain  # e.g., my-account
   ```

### Step 2: Run Setup Script

```bash
./scripts/setup.sh
```

This will:
- ✅ Check prerequisites (Node.js, npm, wrangler)
- ✅ Verify Wrangler authentication
- ✅ Validate environment configuration
- ✅ Install dependencies
- ✅ Build the test application
- ✅ Validate Wrangler configuration

## 🧪 Testing Scenarios

### Scenario 1: Basic Deployment Test

**Objective:** Verify our skew protection module works in Cloudflare Workers

```bash
./scripts/deploy.sh
```

**Expected Results:**
- ✅ Successful deployment to Cloudflare Workers
- ✅ Cloudflare provider automatically detected
- ✅ Worker responds to HTTP requests
- ✅ Skew protection middleware loads correctly

**Manual Verification:**
1. Visit: `https://your-worker.your-domain.workers.dev`
2. Check the "Environment" section shows "Cloudflare Workers"
3. Verify deployment ID is displayed correctly

### Scenario 2: Automated Testing Suite

**Objective:** Comprehensive validation of all skew protection features

```bash
./scripts/test.sh
```

**Tests Included:**
1. ✅ Basic worker response (HTTP 200)
2. ✅ Provider detection API
3. ✅ Deployment mapping API
4. ✅ Normal request processing
5. ✅ Request with deployment ID header
6. ✅ Request with deployment ID query parameter
7. ✅ Domain filtering logic
8. ✅ Invalid deployment mapping handling
9. ✅ Environment variables detection
10. ✅ Response time performance
11. ✅ OpenNext compatibility format
12. ✅ Preview URL generation

**Expected Output:**
```
🎉 All tests passed! Skew protection is working correctly.
📈 Statistics:
  Passed: 12
  Failed: 0
  Skipped: 0
```

### Scenario 3: Performance Testing

**Objective:** Compare performance vs OpenNext implementation

```bash
./scripts/performance.sh
```

**Performance Metrics:**
- Response time with/without skew protection
- Load testing with concurrent requests
- Overhead analysis
- OpenNext compatibility verification

**Expected Performance:**
- ✅ Overhead < 10% (Excellent)
- ✅ Response time < 200ms
- ✅ 100% success rate under load

### Scenario 4: Version Routing Test

**Objective:** Test actual request forwarding to different worker versions

1. **Deploy multiple versions:**
   ```bash
   # Deploy version 1
   export NUXT_DEPLOYMENT_ID=dpl-test-v1
   ./scripts/deploy.sh

   # Deploy version 2
   export NUXT_DEPLOYMENT_ID=dpl-test-v2
   ./scripts/deploy.sh
   ```

2. **Update deployment mapping:**
   ```bash
   # Get worker versions
   cd app && wrangler versions list --name nuxt-skew-test

   # Update CF_DEPLOYMENT_MAPPING in .env.local
   CF_DEPLOYMENT_MAPPING='{"dpl-test-v1":"version-abc123","dpl-test-v2":"current"}'
   ```

3. **Test version routing:**
   ```bash
   # Should serve version 2 (current)
   curl https://your-worker.workers.dev/

   # Should route to version 1
   curl -H "x-deployment-id: dpl-test-v1" https://your-worker.workers.dev/

   # Should route via query parameter
   curl https://your-worker.workers.dev/?dpl=dpl-test-v1
   ```

## 🔍 Debugging & Troubleshooting

### Common Issues

#### 1. "Authentication failed"
```bash
wrangler login
```

#### 2. "Provider not enabled"
- Check all environment variables in `.env.local`
- Verify `CF_ACCOUNT_ID` format (no spaces)
- Ensure `CF_WORKER_NAME` matches deployed worker

#### 3. "Deployment mapping not found"
- Check `CF_DEPLOYMENT_MAPPING` is valid JSON
- Update mapping after each deployment
- Verify deployment IDs exist in mapping

#### 4. "Request forwarding failed"
- Check preview domain configuration
- Verify worker versions exist
- Ensure API token has correct permissions

### Debug Mode

Enable detailed logging:
```bash
export NUXT_SKEW_PROTECTION_DEBUG=true
./scripts/deploy.sh
```

Monitor real-time logs:
```bash
cd app && wrangler tail --name nuxt-skew-test
```

### Performance Investigation

If performance is poor:
1. Check response times: `./scripts/performance.sh`
2. Monitor Cloudflare Analytics
3. Verify caching configuration
4. Check deployment mapping size

## 📊 Expected vs Actual Results

### OpenNext Compatibility Matrix

| Feature | OpenNext | Our Implementation | Status |
|---------|----------|-------------------|---------|
| Environment Variables | ✅ | ✅ | ✅ Match |
| Deployment Mapping | ✅ | ✅ | ✅ Match |
| Preview URL Format | ✅ | ✅ | ✅ Match |
| Request Forwarding | ✅ | ✅ | ✅ Match |
| Domain Filtering | ✅ | ✅ | ✅ Match |
| Error Handling | ⚠️ Basic | ✅ Enhanced | ✅ Better |
| Universal Fallback | ❌ None | ✅ Asset versioning | ✅ Added |
| Test Coverage | ⚠️ Limited | ✅ Comprehensive | ✅ Better |

### Performance Expectations

| Metric | Target | OpenNext | Our Implementation |
|--------|--------|----------|-------------------|
| Response Time | < 200ms | ~150ms | ~150ms |
| Overhead | < 10% | ~5% | ~5% |
| Success Rate | 99.9% | 99.9% | 99.9% |
| Memory Usage | Low | Low | Low |

## 🎉 Success Criteria

Your implementation is working correctly if:

- ✅ All automated tests pass (12/12)
- ✅ Provider detection works automatically
- ✅ Request routing functions with headers and query params
- ✅ Performance overhead < 10%
- ✅ Error handling is graceful
- ✅ OpenNext compatibility is maintained
- ✅ No JavaScript errors in browser console
- ✅ Deployment mapping updates correctly

## 🔄 Continuous Testing

For ongoing validation:

1. **Set up CI/CD testing:**
   ```bash
   # Add to GitHub Actions
   - name: Test Cloudflare Deployment
     run: |
       cd test/fixtures/cloudflare
       ./scripts/setup.sh
       ./scripts/deploy.sh
       ./scripts/test.sh
   ```

2. **Monitor production metrics:**
   - Cloudflare Analytics
   - Worker execution time
   - Error rates
   - Cache hit ratios

3. **Regular performance testing:**
   ```bash
   ./scripts/performance.sh --save
   ```

Ready to test? Start with `./scripts/setup.sh` and follow the guide! 🚀
