#!/usr/bin/env node

/**
 * Cloudflare Durable Objects WebSocket Test Script
 *
 * This script tests the WebSocket-based version update notifications for Cloudflare Durable Objects:
 * 1. Deploy first version using wrangler dev
 * 2. Connect to WebSocket and verify v1 version message
 * 3. Verify server is accessible
 * 4. Deploy second version (v2)
 * 5. Connect to WebSocket and verify v2 version message
 * 6. Verify KV storage contains build metadata (via wrangler CLI)
 * 7. Verify build assets were uploaded to KV namespace
 */

import type { ChildProcess } from 'node:child_process'
import type { TestResult } from './utils.ts'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { execCommand, fetchWithRetry, log, logSection, modifyAppContent, printSummary, runTest, runTestSuite, sleep } from './utils.ts'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixtureDir = resolve(__dirname, '../test/fixtures/cloudflare-durable')

interface DeploymentInfo {
  deploymentId: string
  serverUrl: string
  wranglerProcess: ChildProcess
  port: number
}

const results: TestResult[] = []

async function startWranglerDev(deploymentId: string, port: number, skipBuild = false): Promise<DeploymentInfo> {
  log(`\n📦 Starting Wrangler Dev for version: ${deploymentId}`, 'magenta')

  if (!skipBuild) {
    // Build the application
    log('  🔨 Building application...', 'yellow')
    await execCommand(`NUXT_DEPLOYMENT_ID=${deploymentId} npm run build`, fixtureDir)
  }

  // Start wrangler dev
  log('  🚀 Starting wrangler dev...', 'yellow')
  const wranglerProcess = spawn('npx', [
    'wrangler',
    'dev',
    '.output/server/index.mjs',
    '--assets',
    '.output/public',
    '--port',
    port.toString(),
    '--var',
    `NUXT_DEPLOYMENT_ID:${deploymentId}`,
  ], {
    cwd: fixtureDir,
    env: { ...process.env, NUXT_DEPLOYMENT_ID: deploymentId },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const serverUrl = `http://localhost:${port}`

  // Wait for server to be ready by checking stdout
  await new Promise<void>((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => {
      reject(new Error('Wrangler dev startup timeout'))
    }, 30000)

    wranglerProcess.stdout?.on('data', (data: Buffer) => {
      output += data.toString()
      log(`  [wrangler] ${data.toString().trim()}`, 'cyan')
      if (output.includes('Ready on') || output.includes(`localhost:${port}`)) {
        clearTimeout(timeout)
        resolve()
      }
    })

    wranglerProcess.stderr?.on('data', (data: Buffer) => {
      log(`  [wrangler error] ${data.toString().trim()}`, 'red')
    })

    wranglerProcess.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    wranglerProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout)
        reject(new Error(`Wrangler process exited with code ${code}`))
      }
    })
  })

  // Additional wait for stability
  await sleep(2000)

  // Verify server is responding
  await fetchWithRetry(serverUrl)

  log(`  ✅ Server ready at ${serverUrl}`, 'green')

  return {
    deploymentId,
    serverUrl,
    wranglerProcess,
    port,
  }
}

async function stopWrangler(process: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (!process.killed) {
      process.kill('SIGKILL') // Use SIGKILL for immediate termination
      setTimeout(() => {
        resolve()
      }, 1000)
    }
    else {
      resolve()
    }
  })
}

async function checkVersionViaWebSocket(serverUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const wsUrl = `${serverUrl.replace('http://', 'ws://').replace('https://', 'wss://')}/_skew/ws`
    const ws = new WebSocket(wsUrl)

    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error('WebSocket connection timeout'))
    }, 10000)

    ws.on('open', () => {
      log(`  🔌 WebSocket connected to ${wsUrl}`, 'cyan')
    })

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString())
        log(`  📨 Received message: ${JSON.stringify(message)}`, 'cyan')

        if (message.type === 'connected' && message.version) {
          clearTimeout(timeout)
          ws.close()
          resolve(message.version)
        }
      }
      catch {
        log(`  ⚠️  Failed to parse message: ${data.toString()}`, 'yellow')
      }
    })

    ws.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    ws.on('close', () => {
      log(`  🔌 WebSocket closed`, 'cyan')
    })
  })
}

// Main test execution
async function main() {
  logSection('☁️ Cloudflare Durable Objects WebSocket Test')

  let deployment1: DeploymentInfo | null = null
  let deployment2: DeploymentInfo | null = null

  const port = 8787 // Default Cloudflare Workers port

  try {
    // Test 1: Deploy first version
    await runTest('Deploy first version (v1) with wrangler dev', async () => {
      modifyAppContent(join(fixtureDir, 'app.vue'), 1)
      deployment1 = await startWranglerDev('cf-durable-v1', port)
    }, results)

    // Test 2: Verify WebSocket connection returns v1
    await runTest('Connect to WebSocket and verify v1 version', async () => {
      if (!deployment1)
        throw new Error('Deployment 1 not available')

      const version = await checkVersionViaWebSocket(deployment1.serverUrl)

      if (version !== deployment1.deploymentId) {
        throw new Error(`Expected version ${deployment1.deploymentId}, got ${version}`)
      }

      log(`  ✅ WebSocket reports correct version: ${version}`, 'green')
    }, results)

    // Test 3: Verify server is accessible
    await runTest('Verify server is accessible and renders correctly', async () => {
      if (!deployment1)
        throw new Error('Deployment 1 not available')

      const response = await fetch(deployment1.serverUrl)

      if (!response.ok) {
        throw new Error(`Server returned ${response.status} ${response.statusText}`)
      }

      const html = await response.text()

      if (!html.includes('Cloudflare Durable Objects')) {
        throw new Error(`Page content does not match expected. Got: ${html.substring(0, 200)}...`)
      }

      log(`  ✅ Server is accessible and renders correctly`, 'green')
    }, results)

    // Test 4: Stop v1 and deploy v2
    await runTest('Deploy second version (v2)', async () => {
      if (!deployment1)
        throw new Error('Deployment 1 not available')

      // Modify app content first (before stopping wrangler to avoid file watcher issues)
      modifyAppContent(join(fixtureDir, 'app.vue'), 2)

      // Build v2 while v1 is still running (in separate process)
      log(`  🔨 Building v2...`, 'yellow')
      await execCommand(`NUXT_DEPLOYMENT_ID=cf-durable-v2 npm run build`, fixtureDir)

      // Now stop v1 wrangler process
      log(`  🛑 Stopping v1 wrangler dev...`, 'yellow')
      await stopWrangler(deployment1.wranglerProcess)

      // Kill any remaining processes on the port
      await execCommand(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, fixtureDir)
      await sleep(2000) // Wait for port to be released

      // Start v2 (skip build since we already built it)
      deployment2 = await startWranglerDev('cf-durable-v2', port, true)

      log(`  ✅ v2 deployed successfully`, 'green')
    }, results)

    // Test 5: Verify WebSocket returns v2
    await runTest('Connect to WebSocket and verify v2 version', async () => {
      if (!deployment2)
        throw new Error('Deployment 2 not available')

      const version = await checkVersionViaWebSocket(deployment2.serverUrl)

      if (version !== deployment2.deploymentId) {
        throw new Error(`Expected version ${deployment2.deploymentId}, got ${version}`)
      }

      log(`  ✅ WebSocket reports new version: ${version}`, 'green')
    }, results)

    // Test 6: Verify KV storage persists metadata via wrangler
    await runTest('Verify KV storage contains build metadata (via wrangler)', async () => {
      if (!deployment2)
        throw new Error('Deployment 2 not available')

      // Check the version manifest in KV using wrangler CLI
      log(`  📦 Checking KV namespace for version manifest...`, 'yellow')

      try {
        const kvOutput = await execCommand(
          'npx wrangler kv key get "version-manifest.json" --namespace-id="3de5b8fa99f545c7a78f40ea3fc71646" --remote',
          fixtureDir,
        )

        // KV returns JSON as a string, so we need to parse it twice
        const firstParse = JSON.parse(kvOutput)
        const manifest = typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse

        if (!manifest.current || !manifest.versions) {
          throw new Error(`Invalid manifest structure: ${JSON.stringify(manifest)}`)
        }

        if (manifest.current !== deployment2.deploymentId) {
          throw new Error(`Expected current version ${deployment2.deploymentId}, got ${manifest.current}`)
        }

        log(`  ✅ KV contains version manifest`, 'green')
        log(`  📊 Current version: ${manifest.current}`, 'yellow')
        log(`  📊 Total versions: ${Object.keys(manifest.versions).length}`, 'yellow')
      }
      catch (error: any) {
        throw new Error(`Failed to retrieve manifest from KV: ${error.message}`)
      }

      // Also verify HTTP endpoint still works
      const response = await fetch(`${deployment2.serverUrl}/_nuxt/builds/latest.json`)
      const data = await response.json()

      if (!data.id || data.id !== deployment2.deploymentId) {
        throw new Error(`Latest build metadata missing or incorrect: ${JSON.stringify(data)}`)
      }

      log(`  ✅ HTTP endpoint returns correct metadata`, 'green')
    }, results)

    // Test 7: Verify manifest tracks assets for the version
    await runTest('Verify manifest tracks build assets', async () => {
      if (!deployment2)
        throw new Error('Deployment 2 not available')

      log(`  📦 Checking manifest for ${deployment2.deploymentId} assets...`, 'yellow')

      try {
        const kvOutput = await execCommand(
          'npx wrangler kv key get "version-manifest.json" --namespace-id="3de5b8fa99f545c7a78f40ea3fc71646" --remote',
          fixtureDir,
        )

        // KV returns JSON as a string, parse it twice
        const firstParse = JSON.parse(kvOutput)
        const manifest = typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse
        const versionInfo = manifest.versions[deployment2.deploymentId]

        if (!versionInfo) {
          throw new Error(`Version ${deployment2.deploymentId} not found in manifest`)
        }

        if (!Array.isArray(versionInfo.assets) || versionInfo.assets.length === 0) {
          throw new Error(`No assets listed for version ${deployment2.deploymentId}`)
        }

        log(`  ✅ Found ${versionInfo.assets.length} assets in manifest`, 'green')
        log(`  📦 Sample assets:`, 'yellow')
        versionInfo.assets.slice(0, 3).forEach((asset: string) => {
          log(`     - ${asset}`, 'cyan')
        })
      }
      catch (error: any) {
        throw new Error(`Failed to verify assets: ${error.message}`)
      }
    }, results)

    printSummary(results)
  }
  finally {
    // Stop all wrangler processes
    if (deployment1?.wranglerProcess) {
      await stopWrangler(deployment1.wranglerProcess)
    }
    if (deployment2?.wranglerProcess) {
      await stopWrangler(deployment2.wranglerProcess)
    }
  }
}

runTestSuite(main)
