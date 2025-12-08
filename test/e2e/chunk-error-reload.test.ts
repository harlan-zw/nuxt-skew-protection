import type { ChildProcess } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build, cleanFixture, modifyVersion, sleep, startServer, stopServer } from './utils'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixtureDir = resolve(__dirname, '../fixtures/chunk-error')
const port = 3333

describe('chunk-error-reload', () => {
  let serverProc: ChildProcess | null = null

  beforeAll(() => cleanFixture(fixtureDir), 60000)

  afterAll(async () => {
    if (serverProc)
      await stopServer(serverProc)
  })

  it('hard reloads when chunk files are deleted', async () => {
    // Build and start server
    modifyVersion(fixtureDir, 'v1')
    await build(fixtureDir, 'chunk-test-v1')
    serverProc = await startServer(fixtureDir, port)
    await sleep(2000)

    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    const page = await context.newPage()

    // Collect console messages
    const consoleLogs: string[] = []
    page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`))
    page.on('pageerror', err => consoleLogs.push(`[error] ${err.message}`))

    // Track page loads
    let loadCount = 0
    page.on('load', () => loadCount++)

    // Load home page
    await page.goto(`http://localhost:${port}`)
    await page.waitForSelector('[data-testid="version"]')
    expect(await page.textContent('[data-testid="version"]')).toContain('v1')

    const initialLoads = loadCount

    // Delete ALL chunk files from public/_nuxt (simulating old chunks gone after deploy)
    const nuxtDir = join(fixtureDir, '.output/public/_nuxt')
    const files = readdirSync(nuxtDir)
    for (const file of files) {
      if (file.endsWith('.js')) {
        rmSync(join(nuxtDir, file))
      }
    }

    // Wait a moment for filesystem to settle
    await sleep(500)

    // Click the about link - this will try to load the about chunk which no longer exists
    // The plugin should catch the preload error and trigger a hard reload
    await page.click('[data-testid="about-link"]')

    // Wait for potential reload cycle
    await sleep(5000)

    // The hard reload will fail to load chunks too, but eventually the page will show an error
    // or the test will timeout. Let's check what state we're in.
    const currentUrl = page.url()
    const hasReloaded = loadCount > initialLoads

    console.log('Final state:', {
      url: currentUrl,
      loadCount,
      initialLoads,
      hasReloaded,
    })

    // The key assertion is that a reload was triggered
    // (even if it fails because chunks are gone, the plugin behavior is verified)
    expect(hasReloaded).toBe(true)

    // Log for debugging
    if (!hasReloaded) {
      console.log('Console logs:', consoleLogs.slice(-20))
    }

    await browser.close()
  }, 120000)
})
