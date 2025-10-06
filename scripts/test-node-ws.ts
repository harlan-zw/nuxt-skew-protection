#!/usr/bin/env node

/**
 * WebSocket Version Notification Test Script
 *
 * This script tests the WebSocket-based version update notifications for Node.js:
 * 1. Deploy first version and connect WebSocket client
 * 2. Verify client sends version in connection
 * 3. Verify client with current version receives no update
 * 4. Connect new client with old version
 * 5. Verify old client immediately receives version-update
 * 6. Test WebSocket connection keepalive
 */

import type { TestResult } from './utils.ts'
import { rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { execCommand, fetchWithRetry, log, logSection, modifyAppContent, printSummary, runTest, runTestSuite, sleep, startServer, stopServer } from './utils.ts'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixtureDir = resolve(__dirname, '../test/fixtures/websocket')

interface DeploymentInfo {
  deploymentId: string
  serverUrl: string
  wsUrl: string
  serverProcess: any
  port: number
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

  // Start server
  const serverProcess = await startServer({
    port,
    cwd: fixtureDir,
    command: 'node',
    args: ['.output/server/index.mjs'],
  })

  const serverUrl = `http://localhost:${port}`
  const wsUrl = `ws://localhost:${port}/_skew/ws`

  // Wait for server to be ready
  log('  ⏳ Waiting for server to be ready...', 'yellow')
  await sleep(2000)

  // Verify server is responding
  await fetchWithRetry(serverUrl)

  log(`  ✅ Server ready at ${serverUrl}`, 'green')

  return {
    deploymentId,
    serverUrl,
    wsUrl,
    serverProcess,
    port,
  }
}

interface WSMessage {
  type: string
  version?: string
  timestamp?: number
}

class WSClient {
  private ws: WebSocket | null = null
  private messages: WSMessage[] = []
  private url: string
  private clientVersion: string
  private connected = false

  constructor(baseUrl: string, clientVersion: string) {
    this.url = baseUrl
    this.clientVersion = clientVersion
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url)

      this.ws.on('open', () => {
        log(`  🔌 WebSocket connected (version: ${this.clientVersion})`, 'yellow')
        this.connected = true
        resolve()
      })

      this.ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as WSMessage
          log(`  📨 Received: ${message.type}${message.version ? ` (version: ${message.version})` : ''}`, 'cyan')
          this.messages.push(message)
        }
        catch (error) {
          log(`  ⚠️  Failed to parse message: ${error}`, 'red')
        }
      })

      this.ws.on('error', (error: Error) => {
        log(`  ❌ WebSocket error: ${error.message}`, 'red')
        this.connected = false
        reject(error)
      })

      this.ws.on('close', () => {
        log(`  🔌 WebSocket closed`, 'yellow')
        this.connected = false
      })

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('WebSocket connection timeout'))
        }
      }, 5000)
    })
  }

  getMessages(): WSMessage[] {
    return [...this.messages]
  }

  hasMessageType(type: string): boolean {
    return this.messages.some(msg => msg.type === type)
  }

  getMessagesByType(type: string): WSMessage[] {
    return this.messages.filter(msg => msg.type === type)
  }

  clearMessages(): void {
    this.messages = []
  }

  close(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }
}

async function waitForMessage(client: WSClient, type: string, timeoutMs = 5000): Promise<WSMessage> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const messages = client.getMessagesByType(type)
    if (messages.length > 0) {
      return messages[0]
    }
    await sleep(100)
  }

  throw new Error(`Timeout waiting for message type: ${type}`)
}

// Main test execution
async function main() {
  logSection('🔌 WebSocket Version Notification Test')

  let deployment1: DeploymentInfo | null = null
  let deployment2: DeploymentInfo | null = null
  const clients: WSClient[] = []

  const port = 3400 // Different port from SSE and polling tests

  try {
    // Test 1: Deploy first version
    await runTest('Deploy first version (v1)', async () => {
      modifyAppContent(join(fixtureDir, 'app.vue'), 1)
      deployment1 = await deploy('ws-test-v1', port, true)
    }, results)

    // Test 2: Connect WebSocket client with v1 (current version)
    let client1: WSClient
    await runTest('Connect WebSocket client with v1 version (current)', async () => {
      if (!deployment1)
        throw new Error('Deployment 1 not available')

      client1 = new WSClient(deployment1.wsUrl, deployment1.deploymentId)
      clients.push(client1)
      await client1.connect()

      // Wait for connection acknowledgment
      await waitForMessage(client1, 'connected', 3000)

      log(`  ✅ Client connected and received acknowledgment`, 'green')
    }, results)

    // Test 3: Verify no version-update for current client
    await runTest('Verify v1 client does not receive version-update (same version)', async () => {
      if (!deployment1)
        throw new Error('Deployment 1 not available')

      // Wait a bit to see if any version-update comes through
      await sleep(2000)

      const versionUpdates = client1.getMessagesByType('version-update')
      if (versionUpdates.length > 0) {
        throw new Error(`Client should not receive version-update for same version`)
      }

      log(`  ✅ Client correctly did not receive version-update`, 'green')
    }, results)

    // Test 4: Verify connection stays alive
    await runTest('Verify WebSocket connection stays alive', async () => {
      if (!deployment1)
        throw new Error('Deployment 1 not available')

      await sleep(2000)

      if (!client1.isConnected()) {
        throw new Error('WebSocket connection closed unexpectedly')
      }

      log(`  ✅ Connection remains active`, 'green')
    }, results)

    // Test 5: Deploy v2 (stop v1 server first)
    await runTest('Deploy second version (v2)', async () => {
      if (!deployment1)
        throw new Error('Deployment 1 not available')

      // Stop v1 server
      log(`  🛑 Stopping v1 server...`, 'yellow')
      await stopServer(deployment1.serverProcess)
      await sleep(1000)

      // Deploy v2
      modifyAppContent(join(fixtureDir, 'app.vue'), 2)
      deployment2 = await deploy('ws-test-v2', port, false)

      log(`  ✅ v2 deployed successfully`, 'green')
    }, results)

    // Test 6: Connect client with old version (v1) to v2 server
    await runTest('Connect client with old version and verify server version differs', async () => {
      if (!deployment1 || !deployment2)
        throw new Error('Both deployments not available')

      // Create new client with old version (v1) connecting to v2 server
      const client2 = new WSClient(deployment2.wsUrl, deployment1.deploymentId)
      clients.push(client2)

      client2.clearMessages()
      await client2.connect()

      // Wait for connected acknowledgment
      const connectedMsg = await waitForMessage(client2, 'connected', 3000)

      if (!connectedMsg.version) {
        throw new Error('connected message missing version field')
      }

      // Client should detect version mismatch (server version != client version)
      if (connectedMsg.version === deployment1.deploymentId) {
        throw new Error(`Server version should differ from client version ${deployment1.deploymentId}`)
      }

      if (connectedMsg.version !== deployment2.deploymentId) {
        throw new Error(`Expected server version ${deployment2.deploymentId}, got ${connectedMsg.version}`)
      }

      log(`  ✅ Client detects version mismatch (would trigger manifest fetch)`, 'green')
      log(`  📊 Client version: ${deployment1.deploymentId}`, 'yellow')
      log(`  📊 Server version: ${deployment2.deploymentId}`, 'yellow')
    }, results)

    // Test 7: Connect client with current version and verify no version-update
    await runTest('Connect client with current version (no update expected)', async () => {
      if (!deployment2)
        throw new Error('Deployment 2 not available')

      const client3 = new WSClient(deployment2.wsUrl, deployment2.deploymentId)
      clients.push(client3)

      await client3.connect()

      // Wait for connection acknowledgment
      await waitForMessage(client3, 'connected', 3000)

      // Wait a bit to ensure no version-update comes through
      await sleep(2000)

      const versionUpdates = client3.getMessagesByType('version-update')
      if (versionUpdates.length > 0) {
        throw new Error(`Client with current version should not receive version-update`)
      }

      log(`  ✅ Client with current version correctly did not receive update`, 'green')
    }, results)

    // Test 8: Connect multiple clients simultaneously
    await runTest('Connect multiple clients simultaneously', async () => {
      if (!deployment2)
        throw new Error('Deployment 2 not available')

      const concurrentClients = await Promise.all(
        Array.from({ length: 5 }, async (_, _i) => {
          const client = new WSClient(deployment2.wsUrl, deployment2.deploymentId)
          clients.push(client)
          await client.connect()
          await waitForMessage(client, 'connected', 3000)
          return client
        }),
      )

      // Verify all are connected
      const connectedCount = concurrentClients.filter(c => c.isConnected()).length
      if (connectedCount !== 5) {
        throw new Error(`Expected 5 connected clients, got ${connectedCount}`)
      }

      log(`  ✅ All 5 concurrent clients connected successfully`, 'green')
    }, results)

    printSummary(results)
  }
  finally {
    // Cleanup: close all WebSocket clients
    for (const client of clients) {
      try {
        client.close()
      }
      catch (_e) {
        // Ignore errors during cleanup
      }
    }

    // Stop all servers
    if (deployment1?.serverProcess) {
      await stopServer(deployment1.serverProcess)
    }
    if (deployment2?.serverProcess) {
      await stopServer(deployment2.serverProcess)
    }
  }
}

runTestSuite(main)
