import type { ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build, cleanFixture, sleep, startServer, stopServer } from './utils'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixtureDir = resolve(__dirname, '../fixtures/custom-adapter')
const port = 3341

describe('custom adapter', () => {
  let serverProc: ChildProcess | null = null

  beforeAll(async () => {
    cleanFixture(fixtureDir)
    await build(fixtureDir, 'custom-adapter-v1')
    serverProc = await startServer(fixtureDir, port)
    await sleep(2000)
  }, 120000)

  afterAll(async () => {
    if (serverProc)
      await stopServer(serverProc)
  })

  it('loads a documented project-relative custom adapter module', async () => {
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' })
    const page = await context.newPage()

    await page.goto(`http://localhost:${port}`)
    await page.waitForSelector('[data-testid="adapter-endpoint"]')
    await expect(page.textContent('[data-testid="adapter-endpoint"]')).resolves.toBe('https://updates.example.test')

    await browser.close()
  }, 30000)
})
