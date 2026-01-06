import type { ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { build, cleanFixture, sleep, startServer, stopServer } from './utils'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixtureDir = resolve(__dirname, '../fixtures/bot-detection')
const port = 3338 // unique port

function getConnectionCount(): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/_skew/ws`)
    ws.on('open', () => {
      // Subscribe to stats after connection
      ws.send(JSON.stringify({ type: 'subscribe-stats' }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'stats') {
        ws.close()
        resolve(msg.total)
      }
    })
    ws.on('error', reject)
    setTimeout(() => reject(new Error('timeout')), 5000)
  })
}

describe.sequential('bot-detection', () => {
  let serverProc: ChildProcess | null = null

  beforeAll(async () => {
    cleanFixture(fixtureDir)
    await build(fixtureDir, 'bot-test-v1')
    serverProc = await startServer(fixtureDir, port)
    await sleep(2000)
  }, 120000)

  afterAll(async () => {
    if (serverProc)
      await stopServer(serverProc)
  })

  it('bot user-agent skips WS connection', async () => {
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    })
    const page = await context.newPage()

    await page.goto(`http://localhost:${port}`)
    await sleep(3000)

    const count = await getConnectionCount()
    // Should only have 1 connection: our check connection (bot didn't connect)
    expect(count).toBe(1)

    await browser.close()
  }, 30000)

  it('normal user establishes WS connection', async () => {
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    })
    const page = await context.newPage()

    await page.goto(`http://localhost:${port}`)
    await sleep(3000)

    const count = await getConnectionCount()
    // Should have at least 2 connections: browser + our check connection
    expect(count).toBeGreaterThanOrEqual(2)

    await browser.close()
  }, 30000)
})
