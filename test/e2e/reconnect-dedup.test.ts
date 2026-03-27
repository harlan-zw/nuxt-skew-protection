import type { ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build, cleanFixture, modifyVersion, sleep, startServer, stopServer } from './utils'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixtureDir = resolve(__dirname, '../fixtures/skew-notification')
const port = 3338

describe('reconnect-dedup', () => {
  let serverProc: ChildProcess | null = null

  beforeAll(async () => {
    cleanFixture(fixtureDir)
    modifyVersion(fixtureDir, 'v1', ['index', 'prerendered'])
    await build(fixtureDir, 'dedup-test-v1')
    serverProc = await startServer(fixtureDir, port)
    await sleep(2000)
  }, 120000)

  afterAll(async () => {
    if (serverProc)
      await stopServer(serverProc)
  })

  it('skips duplicate version mismatch messages from SSE reconnections', async () => {
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    })
    const page = await context.newPage()

    // Collect console logs to count "Version mismatch" debug messages
    const versionMismatchLogs: string[] = []
    page.on('console', (msg) => {
      const text = msg.text()
      if (text.includes('Version mismatch'))
        versionMismatchLogs.push(text)
    })

    await page.goto(`http://localhost:${port}`)
    await page.waitForSelector('[data-testid="version"]')

    // Clear any logs from initial SSE connection
    await sleep(500)
    versionMismatchLogs.length = 0

    // Simulate 3 spaced-apart SSE reconnections, each sending the same
    // version mismatch. In reality this happens when SSE auto-reconnects.
    await page.evaluate(async () => {
      const nuxtApp = (window as any).__TEST_NUXT_APP__

      for (let i = 0; i < 3; i++) {
        await nuxtApp.hooks.callHook('skew:message', {
          type: 'connected',
          version: 'new-deploy-v2',
          connectionId: `reconnect-${i}`,
          timestamp: Date.now(),
        })
        // Space apart so each tick 0 has time to fire between messages
        await new Promise(r => setTimeout(r, 500))
      }
    })

    await sleep(500)

    // Without the fix: all 3 messages trigger "Version mismatch" per handler instance.
    // useSkewProtection() is called by both the SW plugin and SkewNotification, so
    // 2 handlers exist. Without dedup: 3 messages x 2 handlers = 6 logs.
    // With the fix: only the first message triggers. 1 message x 2 handlers = 2 logs.
    //
    // Assert that we see significantly fewer logs than the unprotected case.
    // With fix: <=2 (one per handler for the first message only)
    // Without fix: 6 (each message triggers both handlers)
    console.log(`Version mismatch log count: ${versionMismatchLogs.length}`)
    expect(versionMismatchLogs.length).toBeLessThanOrEqual(2)

    await browser.close()
  }, 30000)

  it('does not reload page on repeated reconnection messages', async () => {
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    })
    const page = await context.newPage()

    let loadCount = 0
    page.on('load', () => loadCount++)

    await page.goto(`http://localhost:${port}`)
    await page.waitForSelector('[data-testid="version"]')
    const initialLoads = loadCount

    await page.evaluate(async () => {
      const nuxtApp = (window as any).__TEST_NUXT_APP__
      for (let i = 0; i < 5; i++) {
        await nuxtApp.hooks.callHook('skew:message', {
          type: 'connected',
          version: 'new-deploy-v2',
          connectionId: `storm-${i}`,
          timestamp: Date.now(),
        })
        await new Promise(r => setTimeout(r, 500))
      }
    })

    expect(loadCount).toBe(initialLoads)

    await browser.close()
  }, 30000)
})
