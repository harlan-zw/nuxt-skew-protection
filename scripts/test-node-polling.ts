#!/usr/bin/env node

/**
 * Node.js Polling Strategy Test Script
 *
 * This script tests the polling-based version update detection for Node.js:
 * 1. Deploy first version and verify /_nuxt/builds/latest.json endpoint
 * 2. Verify client can poll for updates via /_nuxt/builds/latest.json
 * 3. Deploy second version with changes
 * 4. Verify polling detects new version via /_nuxt/builds/latest.json
 * 5. Test skew protection: verify old assets remain accessible
 */

import type { TestResult } from './utils.ts'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execCommand, extractAssetsFromHtml, fetchWithRetry, log, logSection, modifyAppContent, printSummary, runTest, runTestSuite, sleep, startServer, stopServer, verifyAssetContent, verifyHtmlContent } from './utils.ts'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixtureDir = resolve(__dirname, '../test/fixtures/node')

interface DeploymentInfo {
  deploymentId: string
  serverUrl: string
  manifestUrl: string
  serverProcess: any
  port: number
  outputDir: string
  nuxtAssets: string[]
  entryAsset?: string
}

const results: TestResult[] = []

async function deploy(deploymentId: string, port: number, cleanStorage = false): Promise<DeploymentInfo> {
  log(`\n📦 Deploying version: ${deploymentId}`, 'magenta')

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

  const originalOutputDir = join(fixtureDir, '.output')

  if (!existsSync(originalOutputDir)) {
    throw new Error('Build failed - output directory not found')
  }

  // Copy output to a deployment-specific directory
  const deploymentOutputDir = join(fixtureDir, `.test-output/${deploymentId}`)
  log(`  📋 Copying output to ${deploymentOutputDir}...`, 'yellow')

  try {
    rmSync(deploymentOutputDir, { recursive: true, force: true })
  }
  catch (_e) {
    // Directory may not exist
  }

  mkdirSync(deploymentOutputDir, { recursive: true })
  cpSync(originalOutputDir, deploymentOutputDir, { recursive: true })

  // Start server
  const serverProcess = await startServer({
    port,
    cwd: fixtureDir,
    command: 'node',
    args: [join(deploymentOutputDir, 'server/index.mjs')],
  })

  const serverUrl = `http://localhost:${port}`
  const manifestUrl = `${serverUrl}/_nuxt/builds/latest.json`

  // Wait for server to be ready
  log('  ⏳ Waiting for server to be ready...', 'yellow')
  await sleep(2000)

  // Verify server is responding
  const response = await fetchWithRetry(serverUrl)
  const html = await response.text()

  // Extract /_nuxt/* asset paths from HTML
  const nuxtAssets = extractAssetsFromHtml(html)

  // Find the main entry point
  const entryMatch = html.match(/"#entry":"(\/_nuxt\/[^"]+)"/)
  const entryAsset = entryMatch ? entryMatch[1] : undefined

  log(`  ✅ Server ready at ${serverUrl}`, 'green')
  log(`  📦 Found ${nuxtAssets.length} /_nuxt/* assets`, 'yellow')
  if (entryAsset) {
    log(`  📦 Entry asset: ${entryAsset}`, 'yellow')
  }

  return {
    deploymentId,
    serverUrl,
    manifestUrl,
    serverProcess,
    port,
    outputDir: deploymentOutputDir,
    nuxtAssets,
    entryAsset,
  }
}

async function verifyBuildManifest(manifestUrl: string, expectedDeploymentId: string): Promise<any> {
  log('  🔍 Verifying /_nuxt/builds/latest.json...', 'yellow')

  const response = await fetchWithRetry(manifestUrl)

  if (!response.ok) {
    throw new Error(`/_nuxt/builds/latest.json returned ${response.status}`)
  }

  const manifestData = await response.json()
  log(`  📊 Manifest data: ${JSON.stringify(manifestData)}`, 'yellow')

  if (!manifestData.id) {
    throw new Error('Deployment ID not found in manifest')
  }

  if (manifestData.id !== expectedDeploymentId) {
    throw new Error(`Expected deployment ID '${expectedDeploymentId}', got '${manifestData.id}'`)
  }

  log(`  ✅ Build manifest valid with deployment ID: ${manifestData.id}`, 'green')
  return manifestData
}

async function verifyAssetsAccessible(
  serverUrl: string,
  assets: string[],
): Promise<void> {
  log(`  🔍 Verifying ${assets.length} assets are accessible...`, 'yellow')

  for (const asset of assets) {
    const assetUrl = `${serverUrl}${asset}`
    const response = await fetchWithRetry(assetUrl)

    if (!response.ok) {
      throw new Error(`Asset ${asset} returned ${response.status}`)
    }
  }

  log(`  ✅ All assets accessible via HTTP`, 'green')
}

async function verifyIndexHtml(serverUrl: string, expectedDeploymentId: string): Promise<void> {
  log(`  🔍 Verifying index.html has deployment ID ${expectedDeploymentId}...`, 'yellow')

  await verifyHtmlContent(serverUrl, [
    { type: 'includes', value: expectedDeploymentId },
  ])

  log(`  ✅ Index.html contains correct deployment ID`, 'green')
}

async function verifyEntryAssetContent(
  serverUrl: string,
  deployment: DeploymentInfo,
  expectedVersion: string,
): Promise<string> {
  if (!deployment.entryAsset) {
    throw new Error('No entry asset found for deployment')
  }

  log(`  🔍 Verifying entry asset contains version ${expectedVersion}...`, 'yellow')

  const content = await verifyAssetContent(
    serverUrl,
    deployment.entryAsset,
    [{ type: 'includes', value: `"${expectedVersion}"` }],
  )

  log(`  ✅ Entry asset contains version "${expectedVersion}"`, 'green')
  return content
}

// Main test execution
async function main() {
  logSection('📊 Node.js Polling Strategy Test')

  let deployment1: DeploymentInfo | null = null
  let deployment2: DeploymentInfo | null = null

  const port = 3300 // Different port from SSE test

  try {
    // Test 1: Deploy first version
    await runTest('Deploy first version (v1)', async () => {
      modifyAppContent(join(fixtureDir, 'app.vue'), 1)
      deployment1 = await deploy('polling-test-v1', port, true)
    }, results)

    // Test 2: Verify v1 build manifest
    await runTest('Verify v1 /_nuxt/builds/latest.json', async () => {
      if (!deployment1)
        throw new Error('Deployment 1 not available')
      await verifyBuildManifest(deployment1.manifestUrl, deployment1.deploymentId)
    }, results)

    // Test 3: Verify v1 assets are accessible
    await runTest('Verify v1 /_nuxt/* assets accessible', async () => {
      if (!deployment1)
        throw new Error('Deployment 1 not available')
      await verifyAssetsAccessible(deployment1.serverUrl, deployment1.nuxtAssets)
      await verifyIndexHtml(deployment1.serverUrl, deployment1.deploymentId)
    }, results)

    // Test 4: Verify v1 entry asset content
    let entryContent1: string
    await runTest('Verify v1 entry asset contains v1 content', async () => {
      if (!deployment1)
        throw new Error('Deployment 1 not available')
      entryContent1 = await verifyEntryAssetContent(deployment1.serverUrl, deployment1, 'v1')
    }, results)

    // Test 5: Deploy v2 (stop v1 server first)
    await runTest('Deploy second version (v2)', async () => {
      if (!deployment1)
        throw new Error('Deployment 1 not available')

      // Stop v1 server
      log(`  🛑 Stopping v1 server...`, 'yellow')
      await stopServer(deployment1.serverProcess)
      await sleep(1000)

      // Deploy v2 on same port
      modifyAppContent(join(fixtureDir, 'app.vue'), 2)
      deployment2 = await deploy('polling-test-v2', port, false)

      log(`  ✅ v2 deployed successfully`, 'green')
    }, results)

    // Test 6: Verify v2 build manifest shows new version
    await runTest('Verify v2 /_nuxt/builds/latest.json shows new version', async () => {
      if (!deployment2)
        throw new Error('Deployment 2 not available')

      const manifest = await verifyBuildManifest(deployment2.manifestUrl, deployment2.deploymentId)

      // Verify manifest ID differs from v1
      if (!deployment1)
        throw new Error('Deployment 1 not available')

      if (manifest.id === deployment1.deploymentId) {
        throw new Error('Manifest should show new deployment ID')
      }

      log(`  ✅ Manifest correctly shows new version`, 'green')
      log(`  📊 Old version: ${deployment1.deploymentId}`, 'yellow')
      log(`  📊 New version: ${deployment2.deploymentId}`, 'yellow')
    }, results)

    // Test 7: Verify v2 assets are accessible
    await runTest('Verify v2 /_nuxt/* assets accessible', async () => {
      if (!deployment2)
        throw new Error('Deployment 2 not available')
      await verifyAssetsAccessible(deployment2.serverUrl, deployment2.nuxtAssets)
      await verifyIndexHtml(deployment2.serverUrl, deployment2.deploymentId)
    }, results)

    // Test 8: Verify v2 entry asset has different content
    await runTest('Verify v2 entry asset contains v2 content (different from v1)', async () => {
      if (!deployment2)
        throw new Error('Deployment 2 not available')

      const entryContent2 = await verifyEntryAssetContent(deployment2.serverUrl, deployment2, 'v2')

      if (entryContent1 === entryContent2) {
        throw new Error('Entry assets should be different between v1 and v2')
      }

      log(`  ✅ Entry assets are different between versions`, 'green')
      log(`  📊 v1 size: ${entryContent1.length} bytes, v2 size: ${entryContent2.length} bytes`, 'yellow')
    }, results)

    // Test 9: Verify v1 assets ARE accessible from v2 server (skew protection)
    await runTest('Verify v1 assets ARE accessible from v2 server (skew protection)', async () => {
      if (!deployment1 || !deployment2)
        throw new Error('Both deployments not available')

      if (deployment1.entryAsset) {
        const oldAssetUrl = `${deployment2.serverUrl}${deployment1.entryAsset}`
        const response = await fetchWithRetry(oldAssetUrl)

        if (!response.ok) {
          throw new Error(`Old asset should be accessible from new server, got ${response.status}`)
        }

        const contentType = response.headers.get('content-type') || ''
        if (!contentType.includes('javascript')) {
          throw new Error(`Expected JavaScript content-type, got: ${contentType}`)
        }

        log(`  ✅ Old v1 assets accessible from v2 server (skew protection working!)`, 'green')
        log(`  📊 Old assets are restored and served correctly from new deployment`, 'yellow')
      }
    }, results)

    // Test 10: Verify polling can detect version changes
    await runTest('Verify polling detects version change', async () => {
      if (!deployment1 || !deployment2)
        throw new Error('Both deployments not available')

      // Simulate client polling behavior:
      // 1. Client has v1 in cookie
      // 2. Client polls /builds/latest.json
      // 3. Client sees v2 in response
      // 4. Client should detect mismatch

      const manifest = await verifyBuildManifest(deployment2.manifestUrl, deployment2.deploymentId)

      // Client would compare manifest.id to cookie value
      const clientVersion = deployment1.deploymentId // Client has old version in cookie
      const serverVersion = manifest.id // Server returns new version

      if (clientVersion === serverVersion) {
        throw new Error('Client should detect version mismatch')
      }

      log(`  ✅ Polling correctly detects version change`, 'green')
      log(`  📊 Client version (cookie): ${clientVersion}`, 'yellow')
      log(`  📊 Server version (manifest): ${serverVersion}`, 'yellow')
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
  }
}

runTestSuite(main)
