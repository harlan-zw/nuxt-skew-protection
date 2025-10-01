# 🛡️ Cloudflare Setup for harlan103@hotmail.com

## Step 1: Cloudflare Account Setup

1. **Login to Cloudflare:**
   - Go to https://dash.cloudflare.com
   - Login with harlan103@hotmail.com

2. **Get Account ID:**
   - On the dashboard, look for "Account ID" in the right sidebar
   - Copy this value (format: `1234567890abcdef1234567890abcdef`)

3. **Create API Token:**
   - Go to https://dash.cloudflare.com/profile/api-tokens
   - Click "Create Token"
   - Use "Workers Scripts:Edit" template
   - Account: Select your account
   - Zone: All zones (or specific zone if you have one)
   - Click "Continue to summary" → "Create Token"
   - **SAVE THIS TOKEN SECURELY** (you can't see it again)

## Step 2: Local Environment Setup

```bash
# Navigate to test directory
cd /home/harlan/pkg/nuxt-skew-protection/test/fixtures/cloudflare

# Install Wrangler CLI globally
npm install -g wrangler

# Login to Cloudflare
wrangler login
# This will open a browser - login with harlan103@hotmail.com

# Create environment file
cp .env.example .env.local
```

## Step 3: Configure .env.local

Edit `.env.local` with your actual values:

```bash
# Cloudflare Configuration
CF_ACCOUNT_ID=your_account_id_from_step_1
CF_WORKERS_SCRIPTS_API_TOKEN=your_api_token_from_step_1
CF_WORKER_NAME=harlan-nuxt-skew-test
CF_PREVIEW_DOMAIN=harlan103  # This will be part of your worker URL

# Deployment Mapping (will be updated during test)
CF_DEPLOYMENT_MAPPING={}

# Nuxt Configuration
NUXT_DEPLOYMENT_ID=dpl-harlan-test-v1
NUXT_BUILD_ID=build-$(date +%s)

# Debug Mode
NUXT_SKEW_PROTECTION_DEBUG=true
```

## Step 4: Run Setup

```bash
# Run the automated setup
./scripts/setup.sh
```

This will:
- ✅ Check if wrangler is installed and authenticated
- ✅ Validate your environment variables
- ✅ Install dependencies
- ✅ Build the test application

## Step 5: Deploy Test Worker

```bash
# Deploy the worker
./scripts/deploy.sh
```

Expected output:
```
🚀 Deploying Nuxt Skew Protection Test to Cloudflare Workers
📋 Deployment ID: dpl-12345678
🔨 Building with deployment ID: dpl-12345678
☁️ Deploying to Cloudflare Workers...
✅ Deployed successfully!
🌐 Worker URL: https://harlan-nuxt-skew-test.harlan103.workers.dev
```

## Step 6: Test the Deployment

```bash
# Run automated tests
./scripts/test.sh
```

Expected results:
- ✅ 12 tests should pass
- ✅ Provider should be detected as "cloudflare"
- ✅ All APIs should respond correctly

## Step 7: Manual Verification

1. **Visit your worker URL:**
   ```
   https://harlan-nuxt-skew-test.harlan103.workers.dev
   ```

2. **Check the interface shows:**
   - ✅ Provider: "Cloudflare Workers"
   - ✅ Worker Name: "harlan-nuxt-skew-test"
   - ✅ Preview Domain: "harlan103"
   - ✅ Deployment ID: "dpl-harlan-test-v1"

3. **Test skew protection features:**
   - Click "Test Current Version" → Should work
   - Click "Test Old Version" → Should handle gracefully
   - Try URL with ?dpl=test-old → Should show routing attempt

## Step 8: Performance Testing

```bash
# Run performance tests
./scripts/performance.sh
```

This will show:
- Response times with/without skew protection
- Overhead analysis
- Load testing results

## Troubleshooting

### Common Issues:

1. **"Authentication failed"**
   ```bash
   wrangler logout
   wrangler login
   ```

2. **"Account ID not found"**
   - Double-check the Account ID from Cloudflare dashboard
   - Make sure there are no extra spaces

3. **"API token invalid"**
   - Regenerate the API token
   - Ensure it has "Workers Scripts:Edit" permission

4. **"Worker name already exists"**
   - Change CF_WORKER_NAME to something unique like:
   ```bash
   CF_WORKER_NAME=harlan-nuxt-skew-test-$(date +%s)
   ```

### Debug Commands:

```bash
# Check wrangler authentication
wrangler whoami

# Check worker status
cd app && wrangler status

# View worker logs
cd app && wrangler tail --name harlan-nuxt-skew-test

# List worker versions
cd app && wrangler versions list --name harlan-nuxt-skew-test
```

## Expected Final Results

After successful setup and testing:

✅ **Worker deployed at:** `https://harlan-nuxt-skew-test.harlan103.workers.dev`
✅ **All 12 tests passing**
✅ **Cloudflare provider automatically detected**
✅ **OpenNext compatibility confirmed**
✅ **Performance overhead < 10%**
✅ **Request routing working with headers and query params**

## Next Steps After Testing

1. **Clean up test worker** (if desired):
   ```bash
   cd app && wrangler delete harlan-nuxt-skew-test
   ```

2. **Use in production:**
   - Copy the working configuration
   - Update your real Nuxt app's nuxt.config.ts
   - Add the module to your production deployment

Ready to start? Run these commands:

```bash
cd /home/harlan/pkg/nuxt-skew-protection/test/fixtures/cloudflare
npm install -g wrangler
wrangler login
cp .env.example .env.local
# Edit .env.local with your Cloudflare details
./scripts/setup.sh
```
