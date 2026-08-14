import type { ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { afterEach, describe, expect, it } from 'vitest'
import { build, cleanFixture, sleep, startServer, stopServer } from './utils'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixtureDir = resolve(__dirname, '../fixtures/reload-strategy')
let serverProc: ChildProcess | null = null

afterEach(async () => {
  if (serverProc)
    await stopServer(serverProc)
  serverProc = null
})

async function testNavigation(strategy: 'prompt' | 'false', port: number, dismiss = false) {
  cleanFixture(fixtureDir)
  await build(fixtureDir, `reload-strategy-${strategy}`, { SKEW_RELOAD_STRATEGY: strategy })
  serverProc = await startServer(fixtureDir, port)
  await sleep(2000)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' })
  const page = await context.newPage()
  let loads = 0
  page.on('load', () => loads++)
  await page.goto(`http://localhost:${port}`)
  const initialLoads = loads
  await page.evaluate(() => (window as any).__TEST_NUXT_APP__.hooks.callHook('app:manifest:update', { id: 'next-build', timestamp: Date.now() }))
  if (dismiss)
    await page.click('[data-testid="dismiss"]')
  await page.click('[data-testid="about-link"]')
  await page.waitForSelector('[data-testid="about"]')
  expect(loads).toBe(initialLoads)
  await browser.close()
}

describe('reload strategy navigation', () => {
  it('does not reload after dismissing a prompt update', () => testNavigation('prompt', 3342, true), 120000)
  it('does not reload when automatic handling is false', () => testNavigation('false', 3343), 120000)
})
