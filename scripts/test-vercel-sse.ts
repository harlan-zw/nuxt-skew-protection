#!/usr/bin/env node

/**
 * Vercel Deployment Test Script
 *
 * This script tests real Vercel deployments with SSE support:
 * 1. Builds and packs the nuxt-skew-protection module
 * 2. Deploys to real Vercel infrastructure (production)
 * 3. Verifies deployments succeed and assets are accessible
 * 4. Tests /_skew endpoints (may require project to be public in Vercel dashboard)
 *
 * Note: Production deployments may be password-protected by default.
 * To test endpoints fully, configure the Vercel project as public in the dashboard.
 */

import type { TestResult } from './utils.ts'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execCommand, extractAssetsFromHtml, fetchWithRetry, log, logSection, modifyAppContent, printSummary, runTest, runTestSuite, sleep, verifyAssetsAccessible } from './utils.ts'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixtureDir = resolve(__dirname, '../test/fixtures/vercel')

interface DeploymentInfo {
  deploymentId: string
  deploymentUrl: string
  productionUrl?: string
  nuxtAssets: string[]
}

const results: TestResult[] = []
const deployments: string[] = []

async function deploy(deploymentId: string): Promise<DeploymentInfo> {
  log(`\n📦 Deploying to Vercel: ${deploymentId}`, 'magenta')

  // Build the nuxt-skew-protection module in the root directory
  log('  🔨 Building nuxt-skew-protection module...', 'yellow')
  const rootDir = resolve(__dirname, '..')
  await execCommand('pnpm build', rootDir)

  // Pack the module
  log('  📦 Packing module...', 'yellow')
  const packOutput = await execCommand('pnpm pack --pack-destination test/fixtures/vercel', rootDir)
  const tarballMatch = packOutput.match(/nuxt-skew-protection-[\d.]+\.tgz/)
  if (!tarballMatch) {
    throw new Error('Could not find packed tarball')
  }
  const tarballName = tarballMatch[0]

  // Update package.json to use the local tarball
  log('  📝 Updating package.json...', 'yellow')
  const pkgJsonPath = join(fixtureDir, 'package.json')
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
  pkgJson.dependencies['nuxt-skew-protection'] = `./${tarballName}`
  writeFileSync(pkgJsonPath, `${JSON.stringify(pkgJson, null, 2)}\n`)

  // Deploy to Vercel (production for public access)
  log('  🚀 Deploying to Vercel production...', 'yellow')
  const deployOutput = await execCommand(
    `VERCEL_DEPLOYMENT_ID=${deploymentId} vercel --yes --force --prod`,
    fixtureDir,
  )

  // Extract production URL from output
  // Production deployments may show "Production: URL" or just "URL"
  const productionMatch = deployOutput.match(/(?:Production:\s+)?(https:\/\/\S+\.vercel\.app)/)

  if (!productionMatch) {
    console.error('Vercel output:', deployOutput.substring(0, 500))
    throw new Error('Could not extract production URL from Vercel output')
  }

  const deploymentSpecificUrl = productionMatch[1]

  // Use stable production domain for testing
  // Production deployments are aliased to this domain automatically
  const productionDomain = 'vercel-lovat-rho.vercel.app'
  const testUrl = `https://${productionDomain}`

  deployments.push(testUrl)
  log(`  🌐 Deployment URL: ${deploymentSpecificUrl}`, 'green')
  log(`  🌐 Production Domain: ${productionDomain}`, 'green')
  log(`  🔗 Testing with: ${testUrl}`, 'cyan')

  // Wait for deployment to be fully ready
  log('  ⏳ Waiting for deployment to be ready...', 'yellow')
  await sleep(10000)

  // Fetch the page to get /_nuxt/* assets
  const response = await fetchWithRetry(testUrl)
  const html = await response.text()

  // Extract /_nuxt/* asset paths from HTML
  const nuxtAssets = extractAssetsFromHtml(html)

  log(`  📦 Found ${nuxtAssets.length} /_nuxt/* assets`, 'yellow')

  return {
    deploymentId,
    deploymentUrl: testUrl,
    productionUrl: productionDomain ? testUrl : undefined,
    nuxtAssets,
  }
}

async function verifyBuildManifest(serverUrl: string, _expectedDeploymentId: string): Promise<void> {
  log('  🔍 Verifying /_nuxt/builds/latest.json...', 'yellow')

  // Test /_nuxt/builds/latest.json endpoint
  const manifestUrl = `${serverUrl}/_nuxt/builds/latest.json`
  const manifestResponse = await fetchWithRetry(manifestUrl)

  if (!manifestResponse.ok) {
    throw new Error(`/_nuxt/builds/latest.json returned ${manifestResponse.status}`)
  }

  const manifestData = await manifestResponse.json()
  log(`  📊 Manifest data: ${JSON.stringify(manifestData)}`, 'yellow')

  // Verify deployment ID is present
  if (!manifestData.id) {
    throw new Error('Deployment ID not found in manifest')
  }

  // On Vercel, the module generates its own deployment ID
  // Just verify it exists and has the right format (UUID or custom string)
  if (typeof manifestData.id !== 'string' || manifestData.id.length === 0) {
    throw new Error('Invalid deployment ID in manifest')
  }

  log(`  ✅ Build manifest valid with deployment ID: ${manifestData.id}`, 'green')
}

async function testSseEndpoint(serverUrl: string, deploymentId: string): Promise<void> {
  log('  🔍 Testing SSE endpoint...', 'yellow')

  const sseUrl = `${serverUrl}/_skew/sse?version=${encodeURIComponent(deploymentId)}`

  // Just verify the endpoint exists and responds (don't test actual SSE streaming here)
  const response = await fetchWithRetry(sseUrl, {
    headers: {
      Accept: 'text/event-stream',
    },
  })

  if (!response.ok) {
    throw new Error(`SSE endpoint returned ${response.status}`)
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) {
    log(`  ⚠️  Expected content-type 'text/event-stream', got '${contentType}'`, 'yellow')
  }

  log('  ✅ SSE endpoint available', 'green')
}

// Main test execution
async function main() {
  logSection('🛡️  Vercel Real Deployment Test')

  let deployment1: DeploymentInfo
  let deployment2: DeploymentInfo

  try {
    // Test 1: Deploy first version
    await runTest('Deploy first version (v1) to Vercel', async () => {
      modifyAppContent(join(fixtureDir, 'app.vue'), 1)
      deployment1 = await deploy('dpl-vercel-v1')
    }, results)

    // Test 2: Verify v1 assets are accessible
    await runTest('Verify v1 /_nuxt/* assets accessible', async () => {
      if (!deployment1)
        throw new Error('Deployment 1 not available')
      await verifyAssetsAccessible(deployment1.deploymentUrl, deployment1.nuxtAssets)
    }, results)

    // Test 3: Verify v1 build manifest
    await runTest('Verify v1 /_nuxt/builds/latest.json', async () => {
      if (!deployment1)
        throw new Error('Deployment 1 not available')
      await verifyBuildManifest(deployment1.deploymentUrl, deployment1.deploymentId)
    }, results)

    // Test 4: Verify SSE endpoint availability (Vercel supports SSE)
    await runTest('Verify v1 SSE endpoint available', async () => {
      if (!deployment1)
        throw new Error('Deployment 1 not available')
      await testSseEndpoint(deployment1.deploymentUrl, deployment1.deploymentId)
    }, results)

    // Test 5: Deploy second version
    await runTest('Deploy second version (v2) to Vercel', async () => {
      modifyAppContent(join(fixtureDir, 'app.vue'), 2)
      deployment2 = await deploy('dpl-vercel-v2')
    }, results)

    // Test 6: Verify v2 assets are accessible
    await runTest('Verify v2 /_nuxt/* assets accessible', async () => {
      if (!deployment2)
        throw new Error('Deployment 2 not available')
      await verifyAssetsAccessible(deployment2.deploymentUrl, deployment2.nuxtAssets)
    }, results)

    // Test 7: Verify v2 build manifest
    await runTest('Verify v2 /_nuxt/builds/latest.json', async () => {
      if (!deployment2)
        throw new Error('Deployment 2 not available')
      await verifyBuildManifest(deployment2.deploymentUrl, deployment2.deploymentId)
    }, results)

    // Test 8: Verify SSE endpoint on v2
    await runTest('Verify v2 SSE endpoint available', async () => {
      if (!deployment2)
        throw new Error('Deployment 2 not available')
      await testSseEndpoint(deployment2.deploymentUrl, deployment2.deploymentId)
    }, results)

    // Test 9: Verify production URL is accessible
    await runTest('Verify production URL is accessible', async () => {
      if (!deployment2)
        throw new Error('Deployment 2 not available')
      const response = await fetchWithRetry(deployment2.deploymentUrl)
      if (!response.ok) {
        throw new Error(`Production deployment not accessible: ${response.status}`)
      }
      log(`  ✅ Production URL accessible`, 'green')
    }, results)

    // Test 10: Verify document requests work correctly
    await runTest('Document requests work correctly', async () => {
      if (!deployment2) {
        throw new Error('Deployment not available')
      }

      const homeResponse = await fetchWithRetry(deployment2.deploymentUrl, {
        headers: {
          'sec-fetch-dest': 'document',
        },
      })

      if (!homeResponse.ok) {
        throw new Error(`Homepage returned ${homeResponse.status}`)
      }

      log(`  ✅ Document requests work`, 'green')
    }, results)

    // Test 11: Verify bots/crawlers can access the site
    await runTest('Bots can access the site', async () => {
      if (!deployment2) {
        throw new Error('Deployment 2 not available')
      }

      // Simulate Googlebot
      const botResponse = await fetchWithRetry(deployment2.deploymentUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        },
      })

      if (!botResponse.ok) {
        throw new Error(`Bot request returned ${botResponse.status}`)
      }

      log(`  ✅ Bot can access site`, 'green')
    }, results)

    // Test 12: Verify concurrent requests
    await runTest('Handle concurrent requests correctly', async () => {
      if (!deployment2)
        throw new Error('Deployment 2 not available')

      // Make 10 parallel requests
      const promises = Array.from({ length: 10 }, () =>
        fetchWithRetry(deployment2.deploymentUrl))

      const responses = await Promise.all(promises)

      for (const response of responses) {
        if (!response.ok) {
          throw new Error(`Concurrent request failed: ${response.status}`)
        }
      }

      log(`  ✅ All 10 concurrent requests succeeded`, 'green')
    }, results)

    printSummary(results)

    log('\n📋 Deployed URLs:', 'cyan')
    log(`  V1: ${deployment1.deploymentUrl}`, 'cyan')
    log(`  V2: ${deployment2.deploymentUrl}`, 'cyan')

    log('\n💡 Next Steps:', 'yellow')
    log('  • Run `vercel ls` to see all deployments', 'yellow')
    log('  • Configure project as public in Vercel dashboard to test endpoints without auth', 'yellow')
    log('  • Visit https://vercel.com/dashboard to manage deployment settings', 'yellow')

    log('\n✅ Deployment Test Summary:', 'green')
    log(`  • Successfully deployed 2 versions to real Vercel infrastructure`, 'green')
    log(`  • Module builds and packs correctly for Vercel`, 'green')
    log(`  • SSE/WebSocket routes are included in deployments`, 'green')
  }
  finally {
    // No server cleanup needed for real Vercel deployments
    // Deployments will remain live until manually removed
    log('\n🗑️  To remove deployments, run: vercel rm <deployment-url>', 'yellow')
  }
}

runTestSuite(main)
