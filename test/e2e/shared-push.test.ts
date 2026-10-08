import type { ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build, cleanFixture, startServer, stopServer } from './utils'

const fixtureDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../fixtures/skew-notification')
const port = 3347
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

describe('shared push updates', () => {
  let server: ChildProcess
  beforeAll(async () => {
    cleanFixture(fixtureDir)
    await build(fixtureDir, 'shared-push-v1')
    server = await startServer(fixtureDir, port)
  }, 120000)
  afterAll(async () => {
    if (server)
      await stopServer(server)
  })

  it('uses one SSE connection for three tabs and transfers ownership after closing the owner', async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const context = await browser.newContext({ userAgent })
      const pages = await Promise.all([0, 1, 2].map(() => context.newPage()))
      const connections: number[] = []
      for (const [index, page] of pages.entries()) {
        page.on('request', (request) => {
          if (new URL(request.url()).pathname === '/__skew/sse')
            connections.push(index)
        })
        await page.goto(`http://localhost:${port}`)
        await page.waitForSelector('[data-testid="version"]')
      }
      await expect.poll(() => connections.length).toBe(1)
      await expect.poll(async () => {
        const locks = await pages[0]!.evaluate(() => navigator.locks.query())
        return locks.pending?.length
      }).toBe(2)
      const owner = connections[0]!
      for (const page of pages) {
        await page.evaluate(() => {
          const app = (window as any).__TEST_NUXT_APP__
          ;(window as any).__manifestUpdates = []
          app.hook('app:manifest:update', (manifest: { id: string }) => {
            ;(window as any).__manifestUpdates.push(manifest.id)
          })
        })
      }
      await pages[owner]!.evaluate(async () => {
        await (window as any).__TEST_NUXT_APP__.hooks.callHook('app:manifest:update', {
          id: 'rollback-v0',
          timestamp: Date.now(),
          skewProtection: { versions: {
            'shared-push-v1': { timestamp: '2026-10-08T00:00:00Z' },
            'rollback-v0': { timestamp: '2026-10-07T00:00:00Z' },
          } },
        })
      })
      for (const page of pages) {
        await expect.poll(() => page.evaluate(() => (window as any).__manifestUpdates)).toEqual(['rollback-v0'])
        expect(await page.evaluate(() => {
          const state = (window as any).__TEST_NUXT_APP__.payload.state
          return { server: state['$sskew-server-version'], manifest: state['$sskew-manifest'] }
        })).toMatchObject({ server: 'rollback-v0', manifest: { id: 'rollback-v0', skewProtection: { versions: { 'rollback-v0': {} } } } })
      }
      // A suspended owner releases its socket; restoring it queues behind the next owner.
      await pages[owner]!.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
      await expect.poll(() => connections.length).toBe(2)
      await pages[owner]!.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
      await expect.poll(async () => (await pages[owner]!.evaluate(() => navigator.locks.query())).pending?.length).toBe(2)
      // Cancel and reconnect a queued tab without leaving a stale lock request.
      await pages[owner]!.evaluate(() => {
        const connection = (window as any).__TEST_SKEW_PROTECTION__
        connection.disconnect()
        connection.connect()
      })
      await expect.poll(async () => (await pages[owner]!.evaluate(() => navigator.locks.query())).pending?.length).toBe(2)
      await pages[connections[1]!]!.close()
      await expect.poll(() => connections.length).toBe(3)
      const nextOwner = connections[2]!
      expect(nextOwner).not.toBe(connections[1])
      await expect.poll(async () => {
        const locks = await pages[nextOwner]!.evaluate(() => navigator.locks.query())
        return { held: locks.held?.length, pending: locks.pending?.length }
      }).toEqual({ held: 1, pending: 1 })
    }
    finally { await browser.close() }
  }, 30000)

  it('updates an older follower when the transport owner already runs the latest build', async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const context = await browser.newContext({ userAgent })
      let deployedVersion = 'shared-push-v1'
      await context.route('**/builds/latest.json?*', async (route) => {
        await route.fulfill({ json: { id: deployedVersion, timestamp: Date.now(), skewProtection: { versions: {
          'shared-push-v0': { timestamp: '2026-10-07T00:00:00Z' },
          'shared-push-v1': { timestamp: '2026-10-08T00:00:00Z' },
        } } } })
      })
      const owner = await context.newPage()
      await owner.addInitScript(() => {
        const NativeEventSource = window.EventSource
        Object.defineProperty(window, 'EventSource', { value: new Proxy(NativeEventSource, {
          construct(target, args) {
            const source = Reflect.construct(target, args)
            ;(window as any).__source = source
            return source
          },
        }) })
      })
      await owner.goto(`http://localhost:${port}`)
      await owner.waitForSelector('[data-testid="version"]')
      await expect.poll(async () => (await owner.evaluate(() => navigator.locks.query())).held?.length).toBe(1)
      await owner.evaluate(() => {
        ;(window as any).__updates = []
        ;(window as any).__TEST_SKEW_PROTECTION__.onAppOutdated((manifest: { id: string }) => {
          ;(window as any).__updates.push(manifest.id)
        })
      })
      const follower = await context.newPage()
      await context.route('**/*', async (route) => {
        if (route.request().isNavigationRequest()) {
          const response = await route.fetch()
          await route.fulfill({ response, body: (await response.text()).replaceAll('shared-push-v1', 'shared-push-v0') })
        }
        else if (route.request().url().includes('/builds/meta/shared-push-v0.json')) {
          const response = await context.request.get(`http://localhost:${port}/_nuxt/builds/meta/shared-push-v1.json`)
          await route.fulfill({ response, body: (await response.text()).replaceAll('shared-push-v1', 'shared-push-v0') })
        }
        else {
          await route.fallback()
        }
      })
      await follower.goto(`http://localhost:${port}`)
      await follower.waitForSelector('[data-testid="version"]')
      await expect.poll(() => follower.evaluate(() => (window as any).__TEST_SKEW_PROTECTION__.manifest.value?.id)).toBe('shared-push-v1')
      expect(await follower.evaluate(() => (window as any).__TEST_SKEW_PROTECTION__.isAppOutdated.value)).toBe(true)
      expect(await owner.evaluate(() => (window as any).__updates)).toEqual([])
      const secondFollower = await context.newPage()
      await secondFollower.goto(`http://localhost:${port}`)
      await secondFollower.waitForSelector('[data-testid="version"]')
      const followers = [follower, secondFollower]
      for (const page of followers)
        await expect.poll(() => page.evaluate(() => (window as any).__TEST_OUTDATED__)).toEqual(['shared-push-v1'])
      expect(await owner.evaluate(() => (window as any).__updates)).toEqual([])

      deployedVersion = 'shared-push-v0'
      await owner.evaluate(() => (window as any).__source.dispatchEvent(new MessageEvent('message', {
        data: JSON.stringify({ type: 'version', version: 'shared-push-v0' }),
      })))
      for (const page of followers)
        await expect.poll(() => page.evaluate(() => (window as any).__TEST_SKEW_PROTECTION__.isAppOutdated.value)).toBe(false)
      await expect.poll(() => owner.evaluate(() => (window as any).__updates)).toEqual(['shared-push-v0'])

      deployedVersion = 'shared-push-v1'
      await owner.evaluate(() => (window as any).__source.dispatchEvent(new MessageEvent('message', {
        data: JSON.stringify({ type: 'version', version: 'shared-push-v1' }),
      })))
      for (const page of followers)
        await expect.poll(() => page.evaluate(() => (window as any).__TEST_OUTDATED__)).toEqual(['shared-push-v1', 'shared-push-v1'])
      expect(await owner.evaluate(() => (window as any).__TEST_SKEW_PROTECTION__.isAppOutdated.value)).toBe(false)
      expect((await owner.evaluate(() => navigator.locks.query())).held).toHaveLength(1)
    }
    finally { await browser.close() }
  }, 30000)

  it('does not reconnect a suspended subscription after public disconnect or an app error', async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const context = await browser.newContext({ userAgent })
      const page = await context.newPage()
      let connections = 0
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/__skew/sse')
          connections++
      })
      await page.goto(`http://localhost:${port}`)
      await page.waitForSelector('[data-testid="version"]')
      await expect.poll(() => connections).toBe(1)
      await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
        ;(window as any).__TEST_SKEW_PROTECTION__.disconnect()
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
      })
      await expect.poll(async () => (await page.evaluate(() => navigator.locks.query())).held?.length).toBe(0)
      expect(connections).toBe(1)
      await page.evaluate(() => (window as any).__TEST_SKEW_PROTECTION__.connect())
      await expect.poll(() => connections).toBe(2)
      await page.evaluate(async () => {
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
        await (window as any).__TEST_NUXT_APP__.hooks.callHook('app:error', new Error('test'))
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
      })
      await expect.poll(async () => (await page.evaluate(() => navigator.locks.query())).held?.length).toBe(0)
      expect(connections).toBe(2)
      await page.evaluate(() => (window as any).__TEST_SKEW_PROTECTION__.connect())
      await expect.poll(() => connections).toBe(3)
      expect((await page.evaluate(() => navigator.locks.query())).held).toHaveLength(0)
    }
    finally { await browser.close() }
  }, 30000)

  it('releases a hidden owner and resumes only a requested visible subscription', async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const context = await browser.newContext({ userAgent })
      const owner = await context.newPage()
      await owner.addInitScript(() => {
        ;(window as any).__visibility = 'visible'
        Object.defineProperty(document, 'visibilityState', { get: () => (window as any).__visibility })
      })
      await owner.goto(`http://localhost:${port}`)
      await owner.waitForSelector('[data-testid="version"]')
      await expect.poll(async () => (await owner.evaluate(() => navigator.locks.query())).held?.length).toBe(1)
      const follower = await context.newPage()
      await follower.addInitScript(() => {
        ;(window as any).__visibility = 'hidden'
        Object.defineProperty(document, 'visibilityState', { get: () => (window as any).__visibility })
      })
      await follower.goto(`http://localhost:${port}`)
      await follower.waitForSelector('[data-testid="version"]')
      expect((await follower.evaluate(() => navigator.locks.query())).pending).toHaveLength(0)
      await owner.evaluate(() => {
        ;(window as any).__visibility = 'hidden'
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await expect.poll(async () => (await follower.evaluate(() => navigator.locks.query())).held?.length).toBe(0)
      await follower.evaluate(() => {
        ;(window as any).__visibility = 'visible'
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await expect.poll(async () => (await follower.evaluate(() => navigator.locks.query())).held?.length).toBe(1)
      await owner.evaluate(() => {
        ;(window as any).__TEST_SKEW_PROTECTION__.disconnect()
        ;(window as any).__visibility = 'visible'
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect((await follower.evaluate(() => navigator.locks.query())).pending).toHaveLength(0)
    }
    finally { await browser.close() }
  }, 30000)

  it.each(['BroadcastChannel', 'Web Locks'])('keeps independent SSE connections when %s is unavailable', async (api) => {
    const browser = await chromium.launch({ headless: true })
    try {
      const context = await browser.newContext({ userAgent })
      await context.addInitScript((api) => {
        if (api === 'BroadcastChannel')
          Object.defineProperty(window, 'BroadcastChannel', { value: undefined })
        else
          Object.defineProperty(navigator, 'locks', { value: undefined })
      }, api)
      let connections = 0
      for (const _ of [0, 1, 2]) {
        const page = await context.newPage()
        page.on('request', (request) => {
          if (new URL(request.url()).pathname === '/__skew/sse')
            connections++
        })
        await page.goto(`http://localhost:${port}`)
        await page.waitForSelector('[data-testid="version"]')
      }
      await expect.poll(() => connections).toBe(3)
    }
    finally { await browser.close() }
  }, 30000)
})
