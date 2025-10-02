import { exec as execCallback, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { createConsola } from 'consola'

const logger = createConsola({
  defaults: { tag: 'nuxt-skew-protection' },
})

const execAsync = promisify(execCallback)

// ANSI color codes for terminal output
export const colors = {
  reset: '\x1B[0m',
  bright: '\x1B[1m',
  red: '\x1B[31m',
  green: '\x1B[32m',
  yellow: '\x1B[33m',
  blue: '\x1B[34m',
  magenta: '\x1B[35m',
  cyan: '\x1B[36m',
} as const

export interface TestResult {
  name: string
  passed: boolean
  error?: string
  duration?: number
}

export function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

export function logSection(title: string) {
  log(`\n${'='.repeat(60)}`, 'cyan')
  log(title, 'cyan')
  log('='.repeat(60), 'cyan')
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function fetchWithRetry(url: string, options: RequestInit = {}, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options)
      return response
    }
    catch (error) {
      if (i === retries - 1)
        throw error
      log(`  Retry ${i + 1}/${retries} for ${url}`, 'yellow')
      await sleep(2000 * (i + 1)) // Exponential backoff
    }
  }
  throw new Error('Should not reach here')
}

export async function runTest(
  name: string,
  testFn: () => Promise<void>,
  results: TestResult[],
): Promise<void> {
  log(`\n🧪 ${name}`, 'blue')
  const start = Date.now()

  try {
    await testFn()
    const duration = Date.now() - start
    results.push({ name, passed: true, duration })
    log(`  ✅ PASS (${duration}ms)`, 'green')
  }
  catch (error: any) {
    const duration = Date.now() - start
    results.push({ name, passed: false, error: error.message, duration })
    log(`  ❌ FAIL (${duration}ms)`, 'red')
    log(`  Error: ${error.message}`, 'red')
  }
}

export function modifyAppContent(appVuePath: string, version: number): void {
  let content = readFileSync(appVuePath, 'utf-8')

  // Update version in ref() declaration
  content = content.replace(
    /const version = ref\('v\d+'\)/,
    `const version = ref('v${version}')`,
  )

  writeFileSync(appVuePath, content)
  log(`  📝 Modified app.vue to version ${version}`, 'yellow')
}

export async function stopServer(serverProcess: any): Promise<void> {
  if (!serverProcess)
    return

  return new Promise((resolve) => {
    serverProcess.on('exit', () => {
      log(`  🛑 Server stopped`, 'yellow')
      resolve()
    })

    serverProcess.kill('SIGTERM')

    // Force kill if not stopped after 5 seconds
    setTimeout(() => {
      try {
        serverProcess.kill('SIGKILL')
      }
      catch (_e) {
        // Process already dead
      }
      resolve()
    }, 5000)
  })
}

export async function verifyAssetsAccessible(
  serverUrl: string,
  assets: string[],
  deploymentId?: string,
): Promise<void> {
  log(`  🔍 Verifying ${assets.length} assets...`, 'yellow')

  for (const asset of assets) {
    const assetUrl = `${serverUrl}${asset}`
    const headers: Record<string, string> = {}

    // Simulate real user experience: use cookie instead of header
    if (deploymentId) {
      headers.Cookie = `skew-version=${deploymentId}`
    }

    const response = await fetchWithRetry(assetUrl, { headers })

    if (!response.ok) {
      throw new Error(
        `Asset ${asset} returned ${response.status}${deploymentId ? ` (deployment: ${deploymentId})` : ''}`,
      )
    }
  }

  log(`  ✅ All assets accessible`, 'green')
}

export function verifyStorageFiles(storagePath: string): { exists: boolean, fileCount: number } {
  log('  🔍 Verifying storage files...', 'yellow')

  if (!existsSync(storagePath)) {
    log(`  ⚠️  Storage directory does not exist yet`, 'yellow')
    return { exists: false, fileCount: 0 }
  }

  const files = readdirSync(storagePath)
  log(`  📁 Found ${files.length} file(s) in storage: ${files.join(', ')}`, 'yellow')

  if (files.length === 0) {
    log(`  ⚠️  Storage directory exists but is empty`, 'yellow')
    return { exists: true, fileCount: 0 }
  }

  // Check for expected files (manifest, deployment metadata, etc.)
  const hasManifest = files.some(f => f.includes('manifest') || f.includes('deployments') || f.includes('versions'))
  if (hasManifest) {
    log(`  ✅ Found manifest/version files`, 'green')
  }

  log(`  ✅ Storage directory has ${files.length} file(s)`, 'green')
  return { exists: true, fileCount: files.length }
}

export function printSummary(results: TestResult[]): void {
  logSection('📊 Test Summary')

  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  const total = results.length

  log(`\nTotal: ${total} | Passed: ${passed} | Failed: ${failed}\n`, 'bright')

  results.forEach((result) => {
    const icon = result.passed ? '✅' : '❌'
    const color = result.passed ? 'green' : 'red'
    const duration = result.duration ? ` (${result.duration}ms)` : ''
    log(`${icon} ${result.name}${duration}`, color)

    if (!result.passed && result.error) {
      log(`   Error: ${result.error}`, 'red')
    }
  })

  if (failed > 0) {
    log('\n❌ Tests failed', 'red')
    process.exit(1)
  }
  else {
    log('\n🎉 All tests passed!', 'green')
    process.exit(0)
  }
}

export function runTestSuite(mainFn: () => Promise<void>): void {
  // Handle cleanup on exit
  const currentServer: any = null

  process.on('SIGINT', async () => {
    log('\n\n⚠️  Interrupted, cleaning up...', 'yellow')
    if (currentServer) {
      await stopServer(currentServer)
    }
    process.exit(1)
  })

  // Run tests
  mainFn().catch((error) => {
    log(`\n❌ Fatal error: ${error.message}`, 'red')
    logger.error(error)
    process.exit(1)
  })
}

// ============================================================================
// Command Execution Utilities
// ============================================================================

export async function execCommand(command: string, cwd: string, options?: { sync?: boolean }): Promise<string> {
  if (options?.sync) {
    // Synchronous execution (for Cloudflare which uses execSync)
    const { execSync } = await import('node:child_process')
    try {
      return execSync(command, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
    }
    catch (error: any) {
      throw new Error(`Command failed: ${command}\n${error.message}`)
    }
  }
  else {
    // Async execution (for Node and Static)
    try {
      const { stdout } = await execAsync(command, {
        cwd,
        encoding: 'utf-8',
        env: { ...process.env },
      })
      return stdout.trim()
    }
    catch (error: any) {
      throw new Error(`Command failed: ${command}\n${error.message}`)
    }
  }
}

// ============================================================================
// Server Management Utilities
// ============================================================================

export interface ServerStartOptions {
  port: number
  cwd: string
  command: string
  args: string[]
  env?: Record<string, string>
  readyPattern?: string | string[]
  startupTimeout?: number
  readyDelay?: number
}

export async function startServer(options: ServerStartOptions): Promise<any> {
  return new Promise((resolve, reject) => {
    const {
      port,
      cwd,
      command,
      args,
      env = {},
      readyPattern = ['Listening', 'ready'],
      startupTimeout = 30000,
      readyDelay = 5000,
    } = options

    log(`  🚀 Starting server on port ${port}...`, 'yellow')

    const serverProcess = spawn(command, args, {
      cwd,
      env: { ...process.env, PORT: port.toString(), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let started = false

    const timeout = setTimeout(() => {
      if (!started) {
        serverProcess.kill()
        reject(new Error('Server startup timeout'))
      }
    }, startupTimeout)

    const patterns = Array.isArray(readyPattern) ? readyPattern : [readyPattern]

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString()
      if (patterns.some(pattern => output.includes(pattern))) {
        if (!started) {
          started = true
          clearTimeout(timeout)
          log(`  ✅ Server started on port ${port}`, 'green')
          resolve(serverProcess)
        }
      }
    })

    serverProcess.stderr?.on('data', (data: Buffer) => {
      log(`  Server stderr: ${data.toString()}`, 'yellow')
    })

    serverProcess.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    serverProcess.on('exit', (code) => {
      if (!started) {
        clearTimeout(timeout)
        reject(new Error(`Server exited with code ${code}`))
      }
    })

    // Fallback: assume ready after delay if no ready pattern detected
    setTimeout(() => {
      if (!started) {
        started = true
        clearTimeout(timeout)
        log(`  ⚠️  Server may be ready (no confirmation message)`, 'yellow')
        resolve(serverProcess)
      }
    }, readyDelay)
  })
}

// ============================================================================
// Config File Utilities
// ============================================================================

export interface ConfigFileUpdate {
  pattern: RegExp
  replacement: string
}

export function updateConfigFile(
  filePath: string,
  updates: ConfigFileUpdate[],
): void {
  let content = readFileSync(filePath, 'utf-8')

  for (const { pattern, replacement } of updates) {
    content = content.replace(pattern, replacement)
  }

  writeFileSync(filePath, content)
}

export function parseConfigFile(
  filePath: string,
  patterns: Record<string, RegExp>,
): Record<string, string> {
  const content = readFileSync(filePath, 'utf-8')
  const result: Record<string, string> = {}

  for (const [key, pattern] of Object.entries(patterns)) {
    const match = content.match(pattern)
    if (match?.[1]) {
      result[key] = match[1]
    }
  }

  return result
}

// ============================================================================
// Asset Verification Utilities
// ============================================================================

export async function verifyHtmlContent(
  serverUrl: string,
  checks: Array<{ type: 'includes' | 'excludes', value: string }>,
): Promise<string> {
  const response = await fetchWithRetry(serverUrl)

  if (!response.ok) {
    throw new Error(`Request returned ${response.status}`)
  }

  const html = await response.text()

  for (const check of checks) {
    if (check.type === 'includes' && !html.includes(check.value)) {
      throw new Error(`Expected HTML to include "${check.value}"`)
    }
    if (check.type === 'excludes' && html.includes(check.value)) {
      throw new Error(`Expected HTML to not include "${check.value}"`)
    }
  }

  return html
}

export async function verifyAssetContent(
  serverUrl: string,
  assetPath: string,
  checks: Array<{ type: 'includes' | 'excludes', value: string }>,
  headers?: Record<string, string>,
): Promise<string> {
  const assetUrl = `${serverUrl}${assetPath}`
  const response = await fetchWithRetry(assetUrl, { headers })

  if (!response.ok) {
    throw new Error(`Asset ${assetPath} returned ${response.status}`)
  }

  const content = await response.text()

  for (const check of checks) {
    if (check.type === 'includes' && !content.includes(check.value)) {
      throw new Error(`Expected asset to include "${check.value}"`)
    }
    if (check.type === 'excludes' && content.includes(check.value)) {
      throw new Error(`Expected asset to not include "${check.value}"`)
    }
  }

  return content
}

export async function verifyEndpoint(
  url: string,
  checks?: {
    expectedStatus?: number
    jsonChecks?: Array<{ path: string, value?: any, exists?: boolean }>
  },
  headers?: Record<string, string>,
): Promise<any> {
  const response = await fetchWithRetry(url, { headers })

  const expectedStatus = checks?.expectedStatus ?? 200
  if (response.status !== expectedStatus) {
    throw new Error(`Expected status ${expectedStatus}, got ${response.status}`)
  }

  if (checks?.jsonChecks) {
    const data = await response.json()

    for (const check of checks.jsonChecks) {
      const keys = check.path.split('.')
      let value = data
      for (const key of keys) {
        value = value?.[key]
      }

      if (check.exists !== undefined) {
        const exists = value !== undefined && value !== null
        if (exists !== check.exists) {
          throw new Error(`Expected ${check.path} to ${check.exists ? 'exist' : 'not exist'}`)
        }
      }

      if (check.value !== undefined && value !== check.value) {
        throw new Error(`Expected ${check.path} to be ${check.value}, got ${value}`)
      }
    }

    return data
  }

  return response
}

// ============================================================================
// Extract Assets from HTML
// ============================================================================

export function extractAssetsFromHtml(html: string, buildAssetsDir = '/_nuxt'): string[] {
  // Escape special regex characters in buildAssetsDir
  const escapedDir = buildAssetsDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`${escapedDir}\\/([^"'\\s]+)`, 'g')
  const assetMatches = html.matchAll(pattern)
  return Array.from(new Set(Array.from(assetMatches, m => `${buildAssetsDir}/${m[1]}`)))
}
