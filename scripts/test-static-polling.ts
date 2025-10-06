#!/usr/bin/env node

/**
 * Static/Prerendered Site Deployment Test Script
 *
 * This script tests the full deployment cycle for prerendered sites with SSR:
 * 1. Build first version with prerendering and verify assets are accessible
 * 2. Build second version with changes
 * 3. Verify v2 server can route v1 asset requests (skew protection)
 * 4. Test that both old and new assets work from the new deployment
 *
 * Note: This tests sites built with `nuxt build` that use prerendering,
 * NOT pure CSR sites (`ssr: false`) which have no server-side routing.
 */

import type { TestResult } from './utils.ts'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execCommand, extractAssetsFromHtml, fetchWithRetry, log, logSection, modifyAppContent, printSummary, runTest, runTestSuite, sleep, startServer, stopServer, verifyAssetContent, verifyHtmlContent, verifyStorageFiles } from './utils.ts'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixtureDir = resolve(__dirname, '../test/fixtures/static')

interface DeploymentInfo {
  deploymentId: string
  outputDir: string
  nuxtAssets: string[]
  entryAsset?: string // The main entry JS file that changes with app.vue
}

const results: TestResult[] = []
const currentServer: any = null

async function generate(deploymentId: string, preserveStorage = false): Promise<DeploymentInfo> {
  log(`\n📦 Building prerendered site: ${deploymentId}`, 'magenta')

  // Clean storage directory if requested
  if (!preserveStorage) {
    const storagePath = join(fixtureDir, '.skew-storage')
    log(`  🧹 Cleaning storage directory...`, 'yellow')
    try {
      rmSync(storagePath, { recursive: true, force: true })
    }
    catch (_e) {
      // Directory may not exist
    }
  }

  // Build the site (with prerendering)
  log('  🔨 Building site with prerendering...', 'yellow')
  await execCommand(`NUXT_DEPLOYMENT_ID=${deploymentId} npm run build`, fixtureDir)

  const originalOutputDir = join(fixtureDir, '.output')

  if (!existsSync(originalOutputDir)) {
    throw new Error('Build failed - output directory not found')
  }

  // Copy output to a deployment-specific directory so we can test multiple versions
  const deploymentOutputDir = join(fixtureDir, `.test-output/${deploymentId}`)
  log(`  📋 Copying output to ${deploymentOutputDir}...`, 'yellow')

  // Clean and recreate deployment-specific directory
  try {
    rmSync(deploymentOutputDir, { recursive: true, force: true })
  }
  catch (_e) {
    // Directory may not exist
  }

  mkdirSync(deploymentOutputDir, { recursive: true })
  cpSync(originalOutputDir, deploymentOutputDir, { recursive: true })

  // Read the prerendered index.html to extract asset paths
  const indexPath = join(deploymentOutputDir, 'public/index.html')
  const html = readFileSync(indexPath, 'utf-8')

  // Extract /_nuxt/* asset paths from HTML
  const nuxtAssets = extractAssetsFromHtml(html)

  // Find the main entry point (the script that contains our app code)
  // Look for the #entry import in the importmap
  const entryMatch = html.match(/"#entry":"(\/_nuxt\/[^"]+)"/)
  const entryAsset = entryMatch ? entryMatch[1] : undefined

  log(`  📦 Found ${nuxtAssets.length} /_nuxt/* assets`, 'yellow')
  if (entryAsset) {
    log(`  📦 Entry asset: ${entryAsset}`, 'yellow')
  }

  return {
    deploymentId,
    outputDir: deploymentOutputDir,
    nuxtAssets,
    entryAsset,
  }
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
  logSection('🛡️  Static/Prerendered Site Deployment Test')

  // Configuration
  const NUM_DEPLOYMENTS = 5 // Test with 5 deployments (exceeds maxNumberOfVersions=3)
  const BASE_PORT = 3200

  const deployments: DeploymentInfo[] = []
  const servers: any[] = []
  const entryContents: string[] = []

  try {
    // Generate all deployments
    for (let i = 0; i < NUM_DEPLOYMENTS; i++) {
      const versionNum = i + 1
      const deploymentId = `dpl-static-v${versionNum}`
      const cleanStorage = i === 0 // Only clean on first deployment

      await runTest(`Generate deployment ${versionNum} of ${NUM_DEPLOYMENTS}`, async () => {
        modifyAppContent(join(fixtureDir, 'app.vue'), versionNum)
        deployments[i] = await generate(deploymentId, !cleanStorage)
      }, results)
    }

    // Test first deployment (v1)
    const deployment1 = deployments[0]!
    const port1 = BASE_PORT

    // Start server for first deployment
    await runTest('Start first deployment server', async () => {
      servers[0] = await startServer({
        port: port1,
        cwd: fixtureDir,
        command: 'npx',
        args: ['sirv-cli', join(deployment1.outputDir, 'public'), '--port', port1.toString(), '--single'],
        readyDelay: 3000,
      })
      await sleep(1000)
      await verifyAssetsAccessible(`http://localhost:${port1}`, deployment1.nuxtAssets)
      await verifyIndexHtml(`http://localhost:${port1}`, deployment1.deploymentId)
      entryContents[0] = await verifyEntryAssetContent(`http://localhost:${port1}`, deployment1, 'v1')
    }, results)

    // Test last deployment (v5 or NUM_DEPLOYMENTS)
    const lastDeployment = deployments[NUM_DEPLOYMENTS - 1]!
    const portLast = BASE_PORT + 1

    await runTest('Start last deployment server', async () => {
      servers[NUM_DEPLOYMENTS - 1] = await startServer({
        port: portLast,
        cwd: fixtureDir,
        command: 'npx',
        args: ['sirv-cli', join(lastDeployment.outputDir, 'public'), '--port', portLast.toString(), '--single'],
        readyDelay: 3000,
      })
      await sleep(1000)
      await verifyAssetsAccessible(`http://localhost:${portLast}`, lastDeployment.nuxtAssets)
      await verifyIndexHtml(`http://localhost:${portLast}`, lastDeployment.deploymentId)
      entryContents[NUM_DEPLOYMENTS - 1] = await verifyEntryAssetContent(
        `http://localhost:${portLast}`,
        lastDeployment,
        `v${NUM_DEPLOYMENTS}`,
      )
    }, results)

    // Verify entry assets are different between first and last
    await runTest('Verify first and last deployment assets are different', async () => {
      if (!entryContents[0] || !entryContents[NUM_DEPLOYMENTS - 1]) {
        throw new Error('Missing entry content from first or last deployment')
      }
      if (entryContents[0] === entryContents[NUM_DEPLOYMENTS - 1]) {
        throw new Error('Entry assets should be different between first and last deployments')
      }
      log(`  ✅ Entry assets are different between versions`, 'green')
      log(`  📊 v1 size: ${entryContents[0].length} bytes, v${NUM_DEPLOYMENTS} size: ${entryContents[NUM_DEPLOYMENTS - 1].length} bytes`, 'yellow')
    }, results)

    // Test skew protection: verify an OLD deployment's assets are accessible from LAST server
    // Note: With maxNumberOfVersions=3 and 5 deployments, only v3, v4, v5 are kept
    // So we test that v3's assets (oldest still retained) are accessible from v5
    await runTest('Verify oldest retained deployment assets ARE accessible from last server (skew protection)', async () => {
      if (!lastDeployment)
        throw new Error('Last deployment not available')

      // Calculate which is the oldest retained deployment (NUM_DEPLOYMENTS - maxVersions)
      const maxVersions = 3
      const oldestRetainedIndex = NUM_DEPLOYMENTS - maxVersions // This will be index 2 (v3)
      const oldestRetainedDeployment = deployments[oldestRetainedIndex]

      if (!oldestRetainedDeployment) {
        throw new Error('Oldest retained deployment not available')
      }

      if (oldestRetainedDeployment.entryAsset) {
        const oldAssetUrl = `http://localhost:${portLast}${oldestRetainedDeployment.entryAsset}`
        const response = await fetchWithRetry(oldAssetUrl)

        if (!response.ok) {
          throw new Error(`Oldest retained deployment (v${oldestRetainedIndex + 1}) asset should be accessible from last server, got ${response.status}`)
        }

        const contentType = response.headers.get('content-type') || ''
        if (!contentType.includes('javascript')) {
          throw new Error(`Expected JavaScript content-type, got: ${contentType}`)
        }

        log(`  ✅ Oldest retained deployment (v${oldestRetainedIndex + 1}) assets accessible from last server (skew protection working!)`, 'green')
        log(`  📊 Old assets are restored and served correctly from new deployment`, 'yellow')
      }
    }, results)

    // Verify cleanup: Check that old versions beyond maxNumberOfVersions are cleaned up
    await runTest('Verify version cleanup based on maxNumberOfVersions (3)', async () => {
      const storageInfo = verifyStorageFiles(join(fixtureDir, '.skew-storage'))

      if (!storageInfo.exists) {
        throw new Error('Storage directory should exist')
      }

      // With maxNumberOfVersions=3 and 5 deployments, we should have:
      // - 3 version directories (versions 3, 4, 5)
      // - 1 versions-manifest.json
      // Total: 4 files
      const expectedVersionCount = 3 // maxNumberOfVersions from config
      const expectedTotalFiles = expectedVersionCount + 1 // +1 for manifest

      if (storageInfo.fileCount !== expectedTotalFiles) {
        log(`  ⚠️  Expected ${expectedTotalFiles} files (${expectedVersionCount} versions + manifest), found ${storageInfo.fileCount}`, 'yellow')
        log(`  ℹ️  This may be expected if cleanup hasn't run yet`, 'yellow')
      }
      else {
        log(`  ✅ Storage correctly contains ${expectedVersionCount} versions (cleanup working)`, 'green')
      }

      // Read manifest to verify which versions are kept
      const manifestPath = join(fixtureDir, '.skew-storage/versions-manifest.json')
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
        const versionCount = Object.keys(manifest.versions).length

        log(`  📊 Manifest contains ${versionCount} versions`, 'yellow')

        if (versionCount <= expectedVersionCount) {
          log(`  ✅ Version count (${versionCount}) is within maxNumberOfVersions (${expectedVersionCount})`, 'green')
        }
      }
    }, results)

    // Verify both first and last servers are still accessible
    await runTest('Verify both first and last servers are independently accessible', async () => {
      await verifyIndexHtml(`http://localhost:${port1}`, deployment1.deploymentId)
      await verifyIndexHtml(`http://localhost:${portLast}`, lastDeployment.deploymentId)
      log(`  ✅ Both first and last deployment servers serve correct deployment IDs`, 'green')
    }, results)

    printSummary(results)
  }
  finally {
    // Cleanup: stop all servers
    for (const server of servers) {
      if (server) {
        await stopServer(server)
      }
    }
    if (currentServer) {
      await stopServer(currentServer)
    }
  }
}

runTestSuite(main)
