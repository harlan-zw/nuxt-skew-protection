import type { ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build, cleanFixture, modifyVersion, sleep, startServer, stopServer } from './utils'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixtureDir = resolve(__dirname, '../fixtures/skew-notification')
const port = 3335

describe('skew-notification', () => {
  let serverProc: ChildProcess | null = null

  beforeAll(async () => {
    cleanFixture(fixtureDir)
    modifyVersion(fixtureDir, 'v1', ['index', 'prerendered'])
    await build(fixtureDir, 'notification-test-v1')
    serverProc = await startServer(fixtureDir, port)
    await sleep(2000)
  }, 120000)

  afterAll(async () => {
    if (serverProc)
      await stopServer(serverProc)
  })

  it('keeps the prompt strategy headless by default', async () => {
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    })
    const page = await context.newPage()

    await page.goto(`http://localhost:${port}/default`)
    await page.waitForSelector('[data-testid="default-page"]')

    await page.evaluate(() => {
      const nuxtApp = (window as any).__TEST_NUXT_APP__
      return nuxtApp?.hooks?.callHook('app:manifest:update', {
        id: 'new-version-v2',
        timestamp: Date.now(),
      })
    })

    await sleep(500)
    expect(await page.$('[data-testid="skew-update-notification"]')).toBeNull()

    await browser.close()
  }, 30000)

  it('shows the native notification when it mounts', async () => {
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    })
    const page = await context.newPage()

    await page.goto(`http://localhost:${port}/native`)
    await page.waitForSelector('[data-testid="native-page"]')

    await page.evaluate(() => {
      const nuxtApp = (window as any).__TEST_NUXT_APP__
      return nuxtApp?.hooks?.callHook('app:manifest:update', {
        id: 'new-version-v3',
        timestamp: Date.now(),
      })
    })

    await page.waitForSelector('[data-testid="skew-update-notification"]', { timeout: 5000 })
    expect(await page.textContent('[data-testid="skew-update-notification"]')).toContain('Update available')
    await page.click('[aria-label="Dismiss update"]')
    await page.waitForSelector('[data-testid="skew-update-notification"]', { state: 'detached' })

    await browser.close()
  }, 30000)

  it('notification reappears for a new version after dismiss', async () => {
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    })
    const page = await context.newPage()

    await page.goto(`http://localhost:${port}/native`)
    await page.waitForSelector('[data-testid="native-page"]')

    const triggerUpdate = (id: string) => {
      return page.evaluate((manifestId) => {
        const nuxtApp = (window as any).__TEST_NUXT_APP__
        return nuxtApp?.hooks?.callHook('app:manifest:update', {
          id: manifestId,
          timestamp: Date.now(),
        })
      }, id)
    }

    await triggerUpdate('dismissed-v2')
    await page.waitForSelector('[data-testid="skew-update-notification"]', { timeout: 5000 })
    await page.click('[aria-label="Dismiss update"]')
    await page.waitForSelector('[data-testid="skew-update-notification"]', { state: 'detached' })

    // A newer deployment must re-enable the notification
    await triggerUpdate('dismissed-v3')
    await page.waitForSelector('[data-testid="skew-update-notification"]', { timeout: 5000 })

    await browser.close()
  }, 30000)

  it('runs a single version check per app across component unmount and remount', async () => {
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    })
    const page = await context.newPage()

    await page.goto(`http://localhost:${port}`)
    await page.waitForSelector('[data-testid="version"]')

    // Record whether the app still reacts to version updates, and how often
    await page.evaluate(() => {
      const nuxtApp = (window as any).__TEST_NUXT_APP__
      ;(window as any).__MANIFEST_UPDATED__ = 0
      nuxtApp.hooks.hook('app:manifest:update', () => {
        (window as any).__MANIFEST_UPDATED__++
      })
    })

    // Client-side navigation unmounts the SkewNotification component
    await page.evaluate(() => {
      const nuxtApp = (window as any).__TEST_NUXT_APP__
      nuxtApp.$router.push('/no-skew-components-here')
    })
    await page.waitForFunction(() => {
      const nuxtApp = (window as any).__TEST_NUXT_APP__
      return nuxtApp?.$router?.currentRoute?.value?.path === '/no-skew-components-here'
    }, undefined, { timeout: 5000 })

    // Navigate back: a fresh SkewNotification mounts
    await page.evaluate(() => {
      const nuxtApp = (window as any).__TEST_NUXT_APP__
      nuxtApp.$router.push('/')
    })
    await page.waitForFunction(() => {
      const nuxtApp = (window as any).__TEST_NUXT_APP__
      return nuxtApp?.$router?.currentRoute?.value?.path === '/'
    }, undefined, { timeout: 5000 })
    await sleep(500)

    // A new deployment is live: make the manifest check see a new build id,
    // and count how many update checks run
    await page.evaluate(() => {
      (window as any).__FETCH_COUNT__ = 0
      const originalFetch = window.$fetch
      window.$fetch = (request: any, options: any) => {
        if (String(request).includes('latest.json')) {
          (window as any).__FETCH_COUNT__++
          return Promise.resolve({ id: 'listener-v2', timestamp: Date.now() })
        }
        return originalFetch(request, options)
      }
    })
    await page.evaluate(() => {
      const nuxtApp = (window as any).__TEST_NUXT_APP__
      return nuxtApp.hooks.callHook('skew:message', { type: 'version', version: 'listener-v2' })
    })

    await page.waitForFunction(() => (window as any).__MANIFEST_UPDATED__ >= 1, undefined, { timeout: 5000 })
    await sleep(500)
    const counts = await page.evaluate(() => ({
      updates: (window as any).__MANIFEST_UPDATED__,
      fetches: (window as any).__FETCH_COUNT__,
    }))
    expect(counts.updates).toBe(1)
    expect(counts.fetches).toBe(1)

    await browser.close()
  }, 30000)

  it('reloads from the native notification', async () => {
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    })
    const page = await context.newPage()

    await page.goto(`http://localhost:${port}/native`)
    await page.waitForSelector('[data-testid="native-page"]')

    await page.evaluate(() => {
      const nuxtApp = (window as any).__TEST_NUXT_APP__
      return nuxtApp?.hooks?.callHook('app:manifest:update', {
        id: 'new-version-v4',
        timestamp: Date.now(),
      })
    })

    await page.waitForSelector('[data-testid="skew-update-notification"]', { timeout: 5000 })
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('button', { name: 'Refresh' }).click(),
    ])
    await page.waitForSelector('[data-testid="native-page"]')

    await browser.close()
  }, 30000)

  it('shows notification when app:manifest:update hook fires', async () => {
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    })
    const page = await context.newPage()

    await page.goto(`http://localhost:${port}`)
    await page.waitForSelector('[data-testid="version"]')

    // Notification should not be visible initially
    let notification = await page.$('[data-testid="skew-notification"]')
    expect(notification).toBeNull()

    // Trigger app:manifest:update hook via exposed nuxtApp
    await page.evaluate(() => {
      const nuxtApp = (window as any).__TEST_NUXT_APP__
      nuxtApp?.hooks?.callHook('app:manifest:update', {
        id: 'new-version-v2',
        timestamp: Date.now(),
      })
    })

    // Wait for notification to appear
    await page.waitForSelector('[data-testid="skew-notification"]', { timeout: 5000 })
    notification = await page.$('[data-testid="skew-notification"]')
    expect(notification).not.toBeNull()
    expect(await page.$('[data-testid="skew-update-notification"]')).toBeNull()

    const message = await page.textContent('[data-testid="notification-message"]')
    expect(message).toContain('new version')

    await browser.close()
  }, 30000)

  it('notification is hidden when no skew detected', async () => {
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    })
    const page = await context.newPage()

    await page.goto(`http://localhost:${port}`)
    await page.waitForSelector('[data-testid="version"]')
    await sleep(2000)

    // No hook fired - notification should stay hidden
    const notification = await page.$('[data-testid="skew-notification"]')
    expect(notification).toBeNull()

    await browser.close()
  }, 30000)

  it('suppresses app:manifest:update on prerendered pages', async () => {
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    })
    const page = await context.newPage()

    await page.goto(`http://localhost:${port}/prerendered`)
    await page.waitForSelector('[data-testid="version"]')

    // Verify page is detected as prerendered
    const prerenderStatus = await page.$('[data-testid="prerender-status"]')
    expect(await prerenderStatus?.getAttribute('data-prerendered')).toBe('true')

    // Trigger app:manifest:update hook (version mismatch)
    await page.evaluate(() => {
      const nuxtApp = (window as any).__TEST_NUXT_APP__
      nuxtApp?.hooks?.callHook('app:manifest:update', {
        id: 'new-version-v2',
        timestamp: Date.now(),
      })
    })

    // Wait a bit, notification should NOT appear on prerendered pages
    await sleep(2000)
    const notification = await page.$('[data-testid="skew-notification"]')
    expect(notification).toBeNull()

    await browser.close()
  }, 30000)

  it('still shows chunks-outdated on prerendered pages', async () => {
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    })
    const page = await context.newPage()

    await page.goto(`http://localhost:${port}/prerendered`)
    await page.waitForSelector('[data-testid="version"]')

    // Trigger skew:chunks-outdated directly (actual broken chunks)
    await page.evaluate(() => {
      const nuxtApp = (window as any).__TEST_NUXT_APP__
      nuxtApp?.hooks?.callHook('skew:chunks-outdated', {
        deletedChunks: ['_nuxt/old-chunk.js'],
        invalidatedModules: ['_nuxt/old-chunk.js'],
        passedReleases: ['v2'],
      })
    })

    // Chunks-outdated SHOULD still show on prerendered pages
    await page.waitForSelector('[data-testid="skew-notification"]', { timeout: 5000 })
    const notification = await page.$('[data-testid="skew-notification"]')
    expect(notification).not.toBeNull()

    await browser.close()
  }, 30000)

  it('dismiss button hides notification', async () => {
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    })
    const page = await context.newPage()

    await page.goto(`http://localhost:${port}`)
    await page.waitForSelector('[data-testid="version"]')

    // Trigger notification via hook
    await page.evaluate(() => {
      const nuxtApp = (window as any).__TEST_NUXT_APP__
      if (nuxtApp?.hooks) {
        nuxtApp.hooks.callHook('app:manifest:update', {
          id: 'new-version-v3',
          timestamp: Date.now(),
        })
      }
    })

    await page.waitForSelector('[data-testid="skew-notification"]', { timeout: 5000 })
    await page.click('[data-testid="dismiss-btn"]')
    await sleep(500)

    const notificationAfter = await page.$('[data-testid="skew-notification"]')
    expect(notificationAfter).toBeNull()

    await browser.close()
  }, 30000)
})
