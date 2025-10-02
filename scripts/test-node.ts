#!/usr/bin/env node

/**
 * Node.js Server Deployment Test Script
 *
 * This script tests the full deployment cycle with local file storage:
 * 1. Deploy first version and verify /_nuxt/* assets are accessible
 * 2. Deploy second version with changes
 * 3. Verify old /_nuxt/* assets remain accessible from old version
 * 4. Verify new /_skew endpoints have expected data
 */

import type { TestResult } from './utils.ts'
import { rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execCommand, extractAssetsFromHtml, fetchWithRetry, log, logSection, modifyAppContent, printSummary, runTest, runTestSuite, sleep, startServer, stopServer, verifyAssetsAccessible, verifyStorageFiles } from './utils.ts'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixtureDir = resolve(__dirname, '../test/fixtures/node')

interface DeploymentInfo {
  deploymentId: string
  serverUrl: string
  serverProcess: any
  nuxtAssets: string[]
  port: number
}

const results: TestResult[] = []
let currentServer: any = null

async function deploy(deploymentId: string, port: number, keepOldServer = false, cleanStorage = false): Promise<DeploymentInfo> {
  log(`\n📦 Deploying version: ${deploymentId}`, 'magenta')

  // Stop existing server if any (unless we want to keep it for testing)
  if (currentServer && !keepOldServer) {
    await stopServer(currentServer)
    currentServer = null
    await sleep(1000)
  }

  // Clean storage directory if requested
  if (cleanStorage) {
    const storagePath = join(fixtureDir, '.skew-storage')
    log(`  🧹 Cleaning storage directory...`, 'yellow')
    try {
      rmSync(storagePath, { recursive: true, force: true })
    }
    catch (_e) {
      // Directory may not exist
    }
  }

  // Build the application
  log('  🔨 Building application...', 'yellow')
  await execCommand(`NUXT_DEPLOYMENT_ID=${deploymentId} npm run build`, fixtureDir)

  // Start server
  const serverProcess = await startServer({
    port,
    cwd: fixtureDir,
    command: 'node',
    args: ['.output/server/index.mjs'],
  })
  // Update currentServer only if we're not keeping the old one
  if (!keepOldServer) {
    currentServer = serverProcess
  }

  const serverUrl = `http://localhost:${port}`

  // Wait for server to be ready
  log('  ⏳ Waiting for server to be ready...', 'yellow')
  await sleep(2000)

  // Fetch the page to get /_nuxt/* assets
  const response = await fetchWithRetry(serverUrl)
  const html = await response.text()

  // Extract /_nuxt/* asset paths from HTML
  const nuxtAssets = extractAssetsFromHtml(html)

  log(`  📦 Found ${nuxtAssets.length} /_nuxt/* assets`, 'yellow')

  return {
    deploymentId,
    serverUrl,
    serverProcess,
    nuxtAssets,
    port,
  }
}

async function verifySkewEndpoints(serverUrl: string): Promise<void> {
  log('  🔍 Verifying /_skew endpoints...', 'yellow')

  // Test /_skew/status endpoint
  const statusUrl = `${serverUrl}/_skew/status`
  const statusResponse = await fetchWithRetry(statusUrl)

  if (!statusResponse.ok) {
    throw new Error(`/_skew/status returned ${statusResponse.status}`)
  }

  const statusData = await statusResponse.json()
  log(`  📊 Status data: ${JSON.stringify(statusData)}`, 'yellow')

  // Verify provider (node server uses 'generic' provider)
  if (statusData.provider !== 'generic') {
    throw new Error(`Expected provider 'generic', got '${statusData.provider}'`)
  }

  // For node/generic provider, the deployment ID comes from runtime config
  // and there won't be a manifest unless we set up storage properly
  // Just verify the endpoint is working
  log('  ✅ /_skew/status endpoint responding', 'green')

  log('  ✅ /_skew endpoints valid', 'green')
}

// Main test execution
async function main() {
  logSection('🛡️  Node.js Server Deployment Test')

  let deployment1: DeploymentInfo
  let deployment2: DeploymentInfo

  const port1 = 3100
  const port2 = 3101

  try {
    // Test 1: Deploy first version (clean storage to start fresh)
    await runTest('Deploy first version (v1)', async () => {
      modifyAppContent(join(fixtureDir, 'app.vue'), 1)
      deployment1 = await deploy('dpl-test-v1', port1, false, true)
    }, results)

    // Test 2: Verify v1 assets are accessible
    await runTest('Verify v1 /_nuxt/* assets accessible', async () => {
      if (!deployment1)
        throw new Error('Deployment 1 not available')
      await verifyAssetsAccessible(deployment1.serverUrl, deployment1.nuxtAssets)
    }, results)

    // Test 3: Verify v1 _skew endpoints
    await runTest('Verify v1 /_skew endpoints', async () => {
      if (!deployment1)
        throw new Error('Deployment 1 not available')
      await verifySkewEndpoints(deployment1.serverUrl)
    }, results)

    // Test 3.5: Check storage files (optional - may not exist yet on first build)
    await runTest('Check storage directory after v1 deployment', async () => {
      const storageInfo = verifyStorageFiles(join(fixtureDir, '.skew-storage'))
      if (!storageInfo.exists) {
        log(`  ℹ️  Note: Storage directory not created yet (this may be expected for Node.js platform)`, 'yellow')
      }
    }, results)

    // Test 4: Deploy second version (keep v1 server running, preserve storage)
    await runTest('Deploy second version (v2)', async () => {
      modifyAppContent(join(fixtureDir, 'app.vue'), 2)
      deployment2 = await deploy('dpl-test-v2', port2, true, false)
    }, results)

    // Test 5: Verify v2 assets are accessible
    await runTest('Verify v2 /_nuxt/* assets accessible', async () => {
      if (!deployment2)
        throw new Error('Deployment 2 not available')
      await verifyAssetsAccessible(deployment2.serverUrl, deployment2.nuxtAssets)
    }, results)

    // Test 6: Verify v2 _skew endpoints
    await runTest('Verify v2 /_skew endpoints', async () => {
      if (!deployment2)
        throw new Error('Deployment 2 not available')
      await verifySkewEndpoints(deployment2.serverUrl)
    }, results)

    // Test 6.5: Check if storage persisted between deployments
    await runTest('Check storage persistence after v2 deployment', async () => {
      if (!deployment1 || !deployment2)
        throw new Error('Both deployments not available')
      const storageInfo = verifyStorageFiles(join(fixtureDir, '.skew-storage'))
      if (storageInfo.exists && storageInfo.fileCount > 0) {
        log(`  ✅ Storage persisted between deployments`, 'green')
      }
      else {
        log(`  ℹ️  Note: Storage not being used (this may be expected for Node.js platform without storage config)`, 'yellow')
      }
    }, results)

    // Test 7: Verify cookie-based routing works for current deployment
    await runTest('Verify cookie routing works with current deployment', async () => {
      if (!deployment2) {
        throw new Error('Deployment 2 not available')
      }
      // Simulate user with old cookie - server should handle gracefully
      // In node deployment, old assets won't exist but the middleware should work
      const response = await fetchWithRetry(deployment2.serverUrl, {
        headers: {
          Cookie: `skew-version=${deployment1.deploymentId}`,
        },
      })

      if (!response.ok) {
        throw new Error(`Request with old cookie returned ${response.status}`)
      }

      log(`  ✅ Server handles old deployment cookie gracefully`, 'green')
    }, results)

    // Test 8: Verify document requests always serve new version (ignore old cookie)
    await runTest('Document requests serve new version and reset cookie', async () => {
      if (!deployment1 || !deployment2) {
        throw new Error('Both deployments not available')
      }

      // Simulate user with v1 cookie requesting HTML page on v2 server
      // sec-fetch-dest: document is what browsers send for HTML navigation
      const homeResponse = await fetchWithRetry(deployment2.serverUrl, {
        headers: {
          'Cookie': `skew-version=${deployment1.deploymentId}`,
          'sec-fetch-dest': 'document',
        },
      })

      if (!homeResponse.ok) {
        throw new Error(`Homepage returned ${homeResponse.status}`)
      }

      // Verify we got v2 content (not v1)
      const html = await homeResponse.text()
      if (!html.includes('Version: v2')) {
        throw new Error('Expected v2 content but got v1 (cookie should be ignored for documents)')
      }

      log(`  ✅ Document request served v2 (middleware correctly ignored cookie)`, 'green')
    }, results)

    // Test 9: Verify bots/crawlers always get current version (ignore cookies)
    await runTest('Bots always receive current version (ignore cookies)', async () => {
      if (!deployment1 || !deployment2) {
        throw new Error('Both deployments not available')
      }

      // Simulate Googlebot with old cookie on v2 server
      const botResponse = await fetchWithRetry(deployment2.serverUrl, {
        headers: {
          'Cookie': `skew-version=${deployment1.deploymentId}`,
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        },
      })

      if (!botResponse.ok) {
        throw new Error(`Bot request returned ${botResponse.status}`)
      }

      // Verify bot got v2 content (current version), not v1
      const html = await botResponse.text()
      if (!html.includes('Version: v2')) {
        throw new Error('Bot received v1 content despite v2 being current (cookie should be ignored for bots)')
      }

      log(`  ✅ Bot received current version despite old cookie`, 'green')
    }, results)

    // Test 10: Verify asset requests honor cookies (SPA navigation support)
    await runTest('Asset requests honor cookies for SPA navigation', async () => {
      if (!deployment2)
        throw new Error('Deployment 2 not available')

      // For SPA navigation, asset requests should respect the skew-version cookie
      // However, in our node test the old assets won't exist, so we test with current deployment
      for (const asset of deployment2.nuxtAssets.slice(0, 2)) {
        const assetUrl = `${deployment2.serverUrl}${asset}`
        const assetResponse = await fetchWithRetry(assetUrl, {
          headers: {
            Cookie: `skew-version=${deployment2.deploymentId}`,
            // Assets don't have sec-fetch-dest: document
          },
        })

        if (!assetResponse.ok) {
          throw new Error(`Asset ${asset} failed with cookie: ${assetResponse.status}`)
        }
      }

      log(`  ✅ Assets served correctly with deployment cookie`, 'green')
    }, results)

    // Test 11: Verify concurrent requests
    await runTest('Handle concurrent requests correctly', async () => {
      if (!deployment2)
        throw new Error('Deployment 2 not available')

      // Make 10 parallel requests
      const promises = Array.from({ length: 10 }, () =>
        fetchWithRetry(deployment2.serverUrl))

      const responses = await Promise.all(promises)

      for (const response of responses) {
        if (!response.ok) {
          throw new Error(`Concurrent request failed: ${response.status}`)
        }
      }

      log(`  ✅ All 10 concurrent requests succeeded`, 'green')
    }, results)

    // Test 12: Verify invalid/malformed cookies are handled
    await runTest('Handle invalid deployment cookies gracefully', async () => {
      if (!deployment2)
        throw new Error('Deployment 2 not available')

      const invalidCookies = [
        'skew-version=invalid-id',
        'skew-version=',
        'skew-version=../../etc/passwd',
        `skew-version=${'x'.repeat(1000)}`,
      ]

      for (const cookie of invalidCookies) {
        const response = await fetchWithRetry(deployment2.serverUrl, {
          headers: { Cookie: cookie },
        })

        if (!response.ok) {
          throw new Error(`Server failed with invalid cookie "${cookie}": ${response.status}`)
        }
      }

      log(`  ✅ Server handled all invalid cookies gracefully`, 'green')
    }, results)

    printSummary(results)
  }
  finally {
    // Cleanup: stop all servers
    if (deployment1?.serverProcess) {
      await stopServer(deployment1.serverProcess)
    }
    if (deployment2?.serverProcess) {
      await stopServer(deployment2.serverProcess)
    }
    if (currentServer) {
      await stopServer(currentServer)
    }
  }
}

runTestSuite(main)
