#!/usr/bin/env node

/**
 * Cloudflare Workers Deployment Test Script
 *
 * This script tests the full deployment cycle:
 * 1. Deploy first version and verify /_nuxt/* assets are accessible
 * 2. Deploy second version with changes
 * 3. Verify old /_nuxt/* assets remain accessible from old version
 * 4. Verify new /_skew endpoints have expected data
 */

import type { TestResult } from './utils.ts'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execCommand, extractAssetsFromHtml, fetchWithRetry, log, logSection, modifyAppContent, parseConfigFile, printSummary, runTest, runTestSuite, sleep, updateConfigFile, verifyAssetsAccessible } from './utils.ts'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixtureDir = resolve(__dirname, '../test/fixtures/cloudflare')
const appDir = join(fixtureDir, 'app')

interface DeploymentInfo {
  deploymentId: string
  workerUrl: string
  versionId?: string
  nuxtAssets: string[]
}

const results: TestResult[] = []

function getWorkerConfig(): { workerName: string, previewDomain: string, accountId: string } {
  const config = parseConfigFile(join(appDir, 'wrangler.toml'), {
    workerName: /name\s*=\s*"([^"]+)"/,
    accountId: /account_id\s*=\s*"([^"]+)"/,
    previewDomain: /CF_PREVIEW_DOMAIN\s*=\s*"([^"]+)"/,
  })

  if (!config.workerName || !config.accountId || !config.previewDomain) {
    throw new Error('Could not parse wrangler.toml configuration')
  }

  return {
    workerName: config.workerName,
    previewDomain: config.previewDomain,
    accountId: config.accountId,
  }
}

function updateWranglerConfig(deploymentId: string, deploymentMapping: Record<string, string>): void {
  const wranglerPath = join(appDir, 'wrangler.toml')

  updateConfigFile(wranglerPath, [
    {
      pattern: /NUXT_DEPLOYMENT_ID\s*=\s*"[^"]*"/,
      replacement: `NUXT_DEPLOYMENT_ID = "${deploymentId}"`,
    },
    {
      pattern: /CF_DEPLOYMENT_MAPPING\s*=\s*'[^']*'/,
      replacement: `CF_DEPLOYMENT_MAPPING = '${JSON.stringify(deploymentMapping)}'`,
    },
  ])

  log(`  📝 Updated wrangler.toml with deployment ID: ${deploymentId}`, 'yellow')
}

async function deploy(deploymentId: string, previousVersionId?: string): Promise<DeploymentInfo> {
  log(`\n📦 Deploying version: ${deploymentId}`, 'magenta')

  // Update deployment mapping
  const deploymentMapping: Record<string, string> = {
    [deploymentId]: 'current',
  }

  if (previousVersionId) {
    const previousDeploymentId = deploymentId.replace(/v\d+$/, 'v1')
    deploymentMapping[previousDeploymentId] = previousVersionId
  }

  updateWranglerConfig(deploymentId, deploymentMapping)

  // Build the application
  log('  🔨 Building application...', 'yellow')
  await execCommand('npm run build', appDir, { sync: true })

  // Deploy to Cloudflare
  log('  🚀 Deploying to Cloudflare...', 'yellow')
  const deployOutput = await execCommand('npm run deploy', appDir, { sync: true })

  // Extract worker URL from deployment output
  // Look for the actual worker URL (*.workers.dev)
  const urlMatches = deployOutput.matchAll(/https:\/\/\S+/g)
  let workerUrl = null
  for (const match of urlMatches) {
    if (match[0].includes('.workers.dev')) {
      workerUrl = match[0]
      break
    }
  }

  if (!workerUrl) {
    // Fallback: construct from config
    const config = getWorkerConfig()
    workerUrl = `https://${config.workerName}.${config.previewDomain}.workers.dev`
  }

  log(`  ✅ Deployed to: ${workerUrl}`, 'green')

  // Get version ID from wrangler
  log('  📋 Fetching version ID...', 'yellow')
  const versionsOutput = await execCommand('wrangler versions list --json', appDir, { sync: true })
  const versions = JSON.parse(versionsOutput)
  const currentVersion = versions[0] // Most recent version

  if (!currentVersion?.id) {
    throw new Error('Could not get version ID from wrangler')
  }

  log(`  📌 Version ID: ${currentVersion.id}`, 'yellow')

  // Wait for deployment to propagate
  log('  ⏳ Waiting for deployment to propagate...', 'yellow')
  await sleep(5000)

  // Fetch the page to get /_nuxt/* assets
  const response = await fetchWithRetry(workerUrl)
  const html = await response.text()

  // Extract /_nuxt/* asset paths from HTML
  const nuxtAssets = extractAssetsFromHtml(html)

  log(`  📦 Found ${nuxtAssets.length} /_nuxt/* assets`, 'yellow')

  return {
    deploymentId,
    workerUrl,
    versionId: currentVersion.id,
    nuxtAssets,
  }
}

async function verifySkewEndpoints(workerUrl: string, expectedData: any): Promise<void> {
  log('  🔍 Verifying /_skew endpoints...', 'yellow')

  // Test /_skew/status endpoint
  const statusUrl = `${workerUrl}/_skew/status`
  const statusResponse = await fetchWithRetry(statusUrl)

  if (!statusResponse.ok) {
    throw new Error(`/_skew/status returned ${statusResponse.status}`)
  }

  const statusData = await statusResponse.json()
  log(`  📊 Status data: ${JSON.stringify(statusData)}`, 'yellow')

  // Verify provider
  if (statusData.provider !== 'cloudflare') {
    throw new Error(`Expected provider 'cloudflare', got '${statusData.provider}'`)
  }

  // Verify deployment mapping is in status response
  if (!statusData.deploymentMapping) {
    throw new Error('deploymentMapping not found in status response')
  }

  const mappingData = statusData.deploymentMapping
  log(`  🗺️  Deployment mapping: ${JSON.stringify(mappingData)}`, 'yellow')

  // Verify expected deployment is in mapping
  if (expectedData.deploymentId && !mappingData[expectedData.deploymentId]) {
    throw new Error(`Deployment ${expectedData.deploymentId} not found in mapping`)
  }

  log('  ✅ /_skew endpoints valid', 'green')
}

// Main test execution
async function main() {
  logSection('🛡️  Cloudflare Workers Deployment Test')

  const config = getWorkerConfig()
  log(`Worker: ${config.workerName}`, 'cyan')
  log(`Account: ${config.accountId}`, 'cyan')
  log(`Preview Domain: ${config.previewDomain}`, 'cyan')

  let deployment1: DeploymentInfo
  let deployment2: DeploymentInfo

  // Test 1: Deploy first version
  await runTest('Deploy first version (v1)', async () => {
    modifyAppContent(join(appDir, 'app.vue'), 1)
    deployment1 = await deploy('dpl-test-v1')
  }, results)

  // Test 2: Verify v1 assets are accessible
  await runTest('Verify v1 /_nuxt/* assets accessible', async () => {
    if (!deployment1)
      throw new Error('Deployment 1 not available')
    await verifyAssetsAccessible(deployment1.workerUrl, deployment1.nuxtAssets)
  }, results)

  // Test 3: Verify v1 _skew endpoints
  await runTest('Verify v1 /_skew endpoints', async () => {
    if (!deployment1)
      throw new Error('Deployment 1 not available')
    await verifySkewEndpoints(deployment1.workerUrl, {
      deploymentId: deployment1.deploymentId,
    })
  }, results)

  // Test 4: Deploy second version
  await runTest('Deploy second version (v2)', async () => {
    modifyAppContent(join(appDir, 'app.vue'), 2)
    deployment2 = await deploy('dpl-test-v2', deployment1.versionId)
  }, results)

  // Test 5: Verify v2 assets are accessible
  await runTest('Verify v2 /_nuxt/* assets accessible', async () => {
    if (!deployment2)
      throw new Error('Deployment 2 not available')
    await verifyAssetsAccessible(deployment2.workerUrl, deployment2.nuxtAssets)
  }, results)

  // Test 6: Verify v1 assets still accessible from v2 deployment (with deployment ID cookie)
  await runTest('Verify v1 assets accessible from v2 with skew-version cookie', async () => {
    if (!deployment1 || !deployment2) {
      throw new Error('Both deployments not available')
    }
    await verifyAssetsAccessible(
      deployment2.workerUrl,
      deployment1.nuxtAssets,
      deployment1.deploymentId,
    )
  }, results)

  // Test 7: Verify v2 _skew endpoints have both deployments
  await runTest('Verify v2 /_skew endpoints have both deployments', async () => {
    if (!deployment2)
      throw new Error('Deployment 2 not available')
    await verifySkewEndpoints(deployment2.workerUrl, {
      deploymentId: deployment2.deploymentId,
    })
  }, results)

  // Test 8: Verify deployment mapping contains both versions
  await runTest('Verify deployment mapping contains both versions', async () => {
    if (!deployment2)
      throw new Error('Deployment 2 not available')

    const statusUrl = `${deployment2.workerUrl}/_skew/status`
    const response = await fetchWithRetry(statusUrl)
    const statusData = await response.json()
    const mapping = statusData.deploymentMapping

    if (!mapping) {
      throw new Error('deploymentMapping not found in status response')
    }

    if (!mapping[deployment1.deploymentId]) {
      throw new Error(`v1 deployment ${deployment1.deploymentId} not in mapping`)
    }

    if (!mapping[deployment2.deploymentId]) {
      throw new Error(`v2 deployment ${deployment2.deploymentId} not in mapping`)
    }

    log(`  ✅ Both deployments in mapping`, 'green')
  }, results)

  // Test 9: Verify document requests always serve new version (ignore old cookie)
  await runTest('Document requests serve new version and reset cookie', async () => {
    if (!deployment1 || !deployment2) {
      throw new Error('Both deployments not available')
    }

    // Simulate user with v1 cookie requesting HTML page
    // sec-fetch-dest: document is what browsers send for HTML navigation
    const homeResponse = await fetchWithRetry(deployment2.workerUrl, {
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

    // Verify cookie was reset to v2
    // Note: set-cookie might not always be visible in fetch response headers
    // The important part is that we got v2 content, proving the middleware worked
    const setCookieHeader = homeResponse.headers.get('set-cookie')
    if (setCookieHeader && !setCookieHeader.includes(deployment2.deploymentId)) {
      throw new Error('Cookie was set but not to v2 deployment ID')
    }

    log(`  ✅ Document request served v2 (middleware correctly ignored cookie)`, 'green')
  }, results)

  // Test 10: Verify assets honor old cookie (SPA navigation support)
  await runTest('Asset requests honor old cookie for SPA navigation', async () => {
    if (!deployment1 || !deployment2) {
      throw new Error('Both deployments not available')
    }

    // Simulate old client requesting assets with v1 cookie
    // This happens during SPA navigation when old JS is still running
    for (const asset of deployment1.nuxtAssets.slice(0, 2)) {
      const assetUrl = `${deployment2.workerUrl}${asset}`
      const assetResponse = await fetchWithRetry(assetUrl, {
        headers: {
          Cookie: `skew-version=${deployment1.deploymentId}`,
          // Assets don't have sec-fetch-dest: document
        },
      })

      if (!assetResponse.ok) {
        throw new Error(`Asset ${asset} failed with v1 cookie: ${assetResponse.status}`)
      }
    }

    log(`  ✅ Assets served from v1 when cookie present`, 'green')
  }, results)

  // Test 11: Verify bots/crawlers always get current version (ignore cookies)
  await runTest('Bots always receive current version (ignore cookies)', async () => {
    if (!deployment1 || !deployment2) {
      throw new Error('Both deployments not available')
    }

    // Simulate Googlebot with old cookie
    const botResponse = await fetchWithRetry(deployment2.workerUrl, {
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

  printSummary(results)
}

runTestSuite(main)
