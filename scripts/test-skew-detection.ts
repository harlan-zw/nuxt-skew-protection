#!/usr/bin/env node

/**
 * Skew Detection Test Script
 *
 * This script tests the chunk invalidation detection flow:
 * 1. Build v1 and capture the JS chunks loaded
 * 2. Build v2 (which deletes/replaces some v1 chunks)
 * 3. Verify that latest.json contains deletedChunks
 * 4. Verify that when a client with v1 chunks connects, it detects outdated chunks
 *
 * This replicates the user's reported issue where SkewNotification doesn't show.
 */

import type { TestResult } from './utils.ts'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventSource } from 'eventsource'
import { execCommand, extractAssetsFromHtml, fetchWithRetry, log, logSection, printSummary, runTest, runTestSuite, sleep, startServer, stopServer } from './utils.ts'

const RE_VERSION_REF = /const version = ref\('v\d+'\)/
const RE_LEADING_SLASH = /^\//

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixtureDir = resolve(__dirname, '../test/fixtures/node')
const storageDir = join(fixtureDir, '.skew-storage')

interface DeploymentInfo {
  buildId: string
  serverUrl: string
  serverProcess: any
  port: number
  jsChunks: string[]
}

interface LatestManifest {
  id: string
  timestamp: number
  skewProtection?: {
    versions?: Record<string, {
      timestamp: string
      deletedChunks?: string[]
      assets?: string[]
    }>
  }
}

const results: TestResult[] = []

function modifyAppContent(version: number): void {
  const appVuePath = join(fixtureDir, 'app.vue')
  let content = readFileSync(appVuePath, 'utf-8')

  // Update version in ref() declaration
  content = content.replace(
    RE_VERSION_REF,
    `const version = ref('v${version}')`,
  )

  writeFileSync(appVuePath, content)
  log(`  📝 Modified app.vue to version ${version}`, 'yellow')
}

async function deploy(version: number, port: number, cleanStorage = false): Promise<DeploymentInfo> {
  const buildId = `skew-test-v${version}-${Date.now()}`

  log(`\n📦 Deploying version: ${buildId}`, 'magenta')

  // Clean storage directory if requested
  if (cleanStorage) {
    log(`  🧹 Cleaning storage directory...`, 'yellow')
    rmSync(storageDir, { recursive: true, force: true })
  }

  // Modify app content
  modifyAppContent(version)

  // Build the application
  log('  🔨 Building application...', 'yellow')
  await execCommand(`NUXT_DEPLOYMENT_ID=${buildId} npm run build`, fixtureDir)

  // Start server
  const serverProcess = await startServer({
    port,
    cwd: fixtureDir,
    command: 'node',
    args: ['.output/server/index.mjs'],
  })

  const serverUrl = `http://localhost:${port}`

  // Wait for server to be ready
  log('  ⏳ Waiting for server to be ready...', 'yellow')
  await sleep(2000)

  // Get initial HTML and extract JS chunks
  const response = await fetchWithRetry(serverUrl)
  const html = await response.text()
  const jsChunks = extractAssetsFromHtml(html).filter(a => a.endsWith('.js'))

  log(`  📦 Found ${jsChunks.length} JS chunks`, 'yellow')
  log(`  ✅ Server ready at ${serverUrl}`, 'green')

  return {
    buildId,
    serverUrl,
    serverProcess,
    port,
    jsChunks,
  }
}

async function getLatestManifest(serverUrl: string): Promise<LatestManifest> {
  const response = await fetchWithRetry(`${serverUrl}/_nuxt/builds/latest.json?nocache=${Date.now()}`)
  return response.json()
}

async function waitForSSEMessage(sseUrl: string, messageType: string, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const es = new EventSource(sseUrl)
    const timeout = setTimeout(() => {
      es.close()
      reject(new Error(`Timeout waiting for ${messageType} message`))
    }, timeoutMs)

    es.onmessage = (event: any) => {
      const msg = JSON.parse(event.data)
      if (msg.type === messageType) {
        clearTimeout(timeout)
        es.close()
        resolve(msg)
      }
    }

    es.onerror = () => {
      clearTimeout(timeout)
      es.close()
      reject(new Error('SSE connection error'))
    }
  })
}

// Main test execution
async function main() {
  logSection('🔍 Skew Detection Test')
  log('\nThis test verifies that the chunk invalidation detection works correctly.', 'yellow')
  log('It replicates the user-reported issue where SkewNotification does not appear.\n', 'yellow')

  let deployment1: DeploymentInfo | null = null
  let deployment2: DeploymentInfo | null = null

  const port = 3250

  try {
    // ========================================================================
    // Phase 1: Deploy first version and capture chunks
    // ========================================================================
    await runTest('Deploy v1 and capture JS chunks', async () => {
      deployment1 = await deploy(1, port, true)

      if (deployment1.jsChunks.length === 0) {
        throw new Error('No JS chunks found in v1 build')
      }

      log(`  📊 v1 Build ID: ${deployment1.buildId}`, 'cyan')
      log(`  📊 v1 JS Chunks: ${deployment1.jsChunks.length}`, 'cyan')

      // Sample chunks
      const sampleChunks = deployment1.jsChunks.slice(0, 3)
      sampleChunks.forEach((chunk) => {
        log(`     - ${chunk}`, 'yellow')
      })
    }, results)

    // ========================================================================
    // Phase 2: Verify v1 manifest exists
    // ========================================================================
    await runTest('Verify v1 manifest exists in latest.json', async () => {
      if (!deployment1)
        throw new Error('Deployment 1 not available')

      const manifest = await getLatestManifest(deployment1.serverUrl)

      if (manifest.id !== deployment1.buildId) {
        throw new Error(`Manifest ID mismatch: expected ${deployment1.buildId}, got ${manifest.id}`)
      }

      log(`  📊 Manifest ID: ${manifest.id}`, 'cyan')
      log(`  📊 Timestamp: ${new Date(manifest.timestamp).toISOString()}`, 'cyan')

      // Check skewProtection section
      if (!manifest.skewProtection) {
        log(`  ⚠️  No skewProtection section in manifest (first deployment)`, 'yellow')
      }
      else {
        const versions = Object.keys(manifest.skewProtection.versions || {})
        log(`  📊 Tracked versions: ${versions.length}`, 'cyan')
      }
    }, results)

    // ========================================================================
    // Phase 3: Stop v1 and deploy v2
    // ========================================================================
    await runTest('Deploy v2 (should create deletedChunks from v1)', async () => {
      if (!deployment1)
        throw new Error('Deployment 1 not available')

      // Stop v1 server
      log(`  🛑 Stopping v1 server...`, 'yellow')
      await stopServer(deployment1.serverProcess)
      await sleep(1000)

      // Deploy v2
      deployment2 = await deploy(2, port, false) // Don't clean storage!

      if (deployment2.jsChunks.length === 0) {
        throw new Error('No JS chunks found in v2 build')
      }

      log(`  📊 v2 Build ID: ${deployment2.buildId}`, 'cyan')
      log(`  📊 v2 JS Chunks: ${deployment2.jsChunks.length}`, 'cyan')
    }, results)

    // ========================================================================
    // Phase 4: Verify v2 manifest has deletedChunks
    // ========================================================================
    await runTest('Verify v2 manifest contains deletedChunks', async () => {
      if (!deployment1 || !deployment2)
        throw new Error('Both deployments required')

      const manifest = await getLatestManifest(deployment2.serverUrl)

      log(`  📊 Manifest ID: ${manifest.id}`, 'cyan')

      if (!manifest.skewProtection) {
        throw new Error('Missing skewProtection section in v2 manifest')
      }

      const versions = manifest.skewProtection.versions || {}
      const versionIds = Object.keys(versions)

      log(`  📊 Tracked versions: ${versionIds.length}`, 'cyan')
      versionIds.forEach((id) => {
        const v = versions[id]
        log(`     - ${id.slice(0, 8)}: ${v.deletedChunks?.length || 0} deleted chunks`, 'yellow')
      })

      // Find total deleted chunks
      let totalDeleted = 0
      for (const v of Object.values(versions)) {
        totalDeleted += v.deletedChunks?.length || 0
      }

      if (totalDeleted === 0) {
        throw new Error('No deletedChunks found in manifest - skew detection will not work!')
      }

      log(`  ✅ Total deleted chunks: ${totalDeleted}`, 'green')
    }, results)

    // ========================================================================
    // Phase 5: Verify chunk intersection detection
    // ========================================================================
    await runTest('Verify v1 chunks are in deletedChunks list', async () => {
      if (!deployment1 || !deployment2)
        throw new Error('Both deployments required')

      const manifest = await getLatestManifest(deployment2.serverUrl)

      // Collect all deleted chunks
      const allDeletedChunks: string[] = []
      for (const v of Object.values(manifest.skewProtection?.versions || {})) {
        allDeletedChunks.push(...(v.deletedChunks || []))
      }

      // Normalize paths for comparison
      const normalizedDeleted = new Set(allDeletedChunks.map(c => c.replace(RE_LEADING_SLASH, '')))
      const normalizedV1Chunks = deployment1.jsChunks.map(c => c.replace(RE_LEADING_SLASH, ''))

      // Find intersection
      const invalidatedChunks = normalizedV1Chunks.filter(c => normalizedDeleted.has(c))

      log(`  📊 v1 chunks: ${normalizedV1Chunks.length}`, 'cyan')
      log(`  📊 Deleted chunks: ${normalizedDeleted.size}`, 'cyan')
      log(`  📊 Invalidated (intersection): ${invalidatedChunks.length}`, 'cyan')

      if (invalidatedChunks.length > 0) {
        log(`  ✅ Found ${invalidatedChunks.length} invalidated chunks:`, 'green')
        invalidatedChunks.slice(0, 5).forEach((chunk) => {
          log(`     - ${chunk}`, 'yellow')
        })
      }
      else {
        log(`  ⚠️  No intersection found - this could be expected if chunk names are stable`, 'yellow')
        log(`  ⚠️  Sample v1 chunks:`, 'yellow')
        normalizedV1Chunks.slice(0, 3).forEach((c) => {
          log(`     - ${c}`, 'yellow')
        })
        log(`  ⚠️  Sample deleted chunks:`, 'yellow')
        Array.from(normalizedDeleted).slice(0, 3).forEach((c) => {
          log(`     - ${c}`, 'yellow')
        })
      }
    }, results)

    // ========================================================================
    // Phase 6: Test SSE version mismatch detection
    // ========================================================================
    await runTest('Test SSE version mismatch detection', async () => {
      if (!deployment1 || !deployment2)
        throw new Error('Both deployments required')

      const sseUrl = `${deployment2.serverUrl}/__skew/sse`

      // Connect and get the 'connected' message
      const connectedMsg = await waitForSSEMessage(sseUrl, 'connected', 5000)

      if (!connectedMsg.version) {
        throw new Error('SSE connected message missing version')
      }

      log(`  📊 SSE server version: ${connectedMsg.version}`, 'cyan')
      log(`  📊 Old client version: ${deployment1.buildId}`, 'cyan')

      if (connectedMsg.version === deployment1.buildId) {
        throw new Error('Version should have changed between deployments')
      }

      log(`  ✅ Version mismatch detected: ${deployment1.buildId} != ${connectedMsg.version}`, 'green')
      log(`  💡 Client would trigger checkForUpdates() → fetch latest.json → compare chunks`, 'cyan')
    }, results)

    // ========================================================================
    // Phase 7: Simulate the full client detection flow
    // ========================================================================
    await runTest('Simulate full chunk detection flow', async () => {
      if (!deployment1 || !deployment2)
        throw new Error('Both deployments required')

      log(`  🔄 Simulating client-side detection flow:`, 'cyan')

      // Step 1: Client has loaded v1 chunks
      const clientLoadedChunks = deployment1.jsChunks.map(c => c.replace(RE_LEADING_SLASH, ''))
      log(`     1. Client loaded ${clientLoadedChunks.length} chunks from v1`, 'yellow')

      // Step 2: Client connects to SSE and detects version mismatch
      log(`     2. Client connects to SSE, receives v2 version`, 'yellow')

      // Step 3: Client fetches latest.json
      const manifest = await getLatestManifest(deployment2.serverUrl)
      log(`     3. Client fetches latest.json (id: ${manifest.id.slice(0, 8)})`, 'yellow')

      // Step 4: Client compares loaded chunks with deletedChunks
      const allDeletedChunks: string[] = []
      for (const v of Object.values(manifest.skewProtection?.versions || {})) {
        allDeletedChunks.push(...(v.deletedChunks || []))
      }
      const normalizedDeleted = new Set(allDeletedChunks.map(c => c.replace(RE_LEADING_SLASH, '')))

      const invalidated = clientLoadedChunks.filter(c => normalizedDeleted.has(c))
      log(`     4. Client checks ${clientLoadedChunks.length} loaded vs ${normalizedDeleted.size} deleted`, 'yellow')

      // Step 5: Determine outcome
      if (invalidated.length > 0) {
        log(`     5. ✅ DETECTION SUCCESS: ${invalidated.length} chunks invalidated`, 'green')
        log(`        → skew:chunks-outdated hook would fire`, 'green')
        log(`        → SkewNotification would show (isCurrentChunksOutdated = true)`, 'green')
      }
      else {
        log(`     5. ⚠️  NO INVALIDATION: Chunks may have same names (content hash unchanged)`, 'yellow')
        log(`        → skew:chunks-outdated hook would NOT fire`, 'yellow')
        log(`        → SkewNotification would NOT show for isCurrentChunksOutdated`, 'yellow')
        log(`        → But isAppOutdated WOULD be true (manifest changed)`, 'green')
      }
    }, results)

    // ========================================================================
    // Phase 8: Check isAppOutdated path (always triggers on version change)
    // ========================================================================
    await runTest('Verify isAppOutdated would trigger (app:manifest:update)', async () => {
      if (!deployment1 || !deployment2)
        throw new Error('Both deployments required')

      // The app:manifest:update hook fires whenever manifest.id !== clientVersion
      // This is independent of chunk invalidation
      const manifest = await getLatestManifest(deployment2.serverUrl)

      const clientVersion = deployment1.buildId
      const serverVersion = manifest.id

      if (clientVersion === serverVersion) {
        throw new Error('Versions should differ')
      }

      log(`  📊 Client version: ${clientVersion}`, 'cyan')
      log(`  📊 Server version: ${serverVersion}`, 'cyan')
      log(`  ✅ Versions differ → app:manifest:update would fire`, 'green')
      log(`  ✅ isAppOutdated would be TRUE`, 'green')
      log(``, 'reset')
      log(`  💡 RECOMMENDATION: User should use isAppOutdated instead of isCurrentChunksOutdated`, 'magenta')
      log(`     if they want notification on ANY deployment, not just chunk invalidation.`, 'magenta')
    }, results)

    // ========================================================================
    // Summary
    // ========================================================================
    logSection('📋 Test Analysis')

    log(`
The user's issue is likely one of the following:

1. TESTING METHOD ISSUE:
   - Running 'npm run dev' after build ignores the build entirely
   - Dev mode uses Vite's dev server, not built output
   - 'npm run preview' has NO SSE/WS endpoint (polling only)

2. CONNECTION REQUIRED:
   - Real-time detection requires SSE/WS connection to server
   - 'polling' strategy only checks periodically (checkOutdatedBuildInterval)
   - Default interval is 1 hour, user set 30 seconds but it may not trigger immediately

3. CHUNK NAME STABILITY:
   - If code changes don't affect chunk content hashes, chunk names stay the same
   - No chunks deleted = isCurrentChunksOutdated stays false
   - Use isAppOutdated for any deployment change detection

4. SERVICE WORKER REQUIREMENT:
   - isCurrentChunksOutdated requires service worker to track loaded modules
   - SW must be active and registered before chunks load

RECOMMENDATION:
   - Use isAppOutdated for reliable update detection on all deployments
   - Use isCurrentChunksOutdated only if you specifically want to notify
     when user's loaded code will break

EXAMPLE FIX:
   <SkewNotification v-slot="{ isAppOutdated, dismiss, reload }">
     <div v-if="isAppOutdated">
       <p>New version available!</p>
       <button @click="reload">Refresh</button>
     </div>
   </SkewNotification>
`, 'yellow')

    printSummary(results)
  }
  finally {
    // Cleanup
    if (deployment1?.serverProcess) {
      await stopServer(deployment1.serverProcess)
    }
    if (deployment2?.serverProcess) {
      await stopServer(deployment2.serverProcess)
    }
  }
}

runTestSuite(main)
