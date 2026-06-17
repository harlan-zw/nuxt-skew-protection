import type { ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build, cleanFixture, sleep, startServer, stopServer } from './utils'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixtureDir = resolve(__dirname, '../fixtures/path-routed')
const port = 3351 // unique port
const base = `http://localhost:${port}`
const DEPLOYMENT_ID = 'path-routed-v1'

// The fixture serves chunks from `/pro/_nuxt/` and sets NO explicit skew
// `basePath` or `cookie.name`. Both must be auto-detected from the mount point
// so a worker that only owns `/pro/*` on a shared host gets endpoints + a cookie
// that resolve to itself, not the app that owns the root route.
describe.sequential('path-routed auto-detection', () => {
  let serverProc: ChildProcess | null = null

  beforeAll(async () => {
    cleanFixture(fixtureDir)
    await build(fixtureDir, DEPLOYMENT_ID)
    serverProc = await startServer(fixtureDir, port)
    await sleep(2000)
  }, 120000)

  afterAll(async () => {
    if (serverProc)
      await stopServer(serverProc)
  })

  it('mounts the health endpoint under the auto-detected /pro/__skew prefix', async () => {
    const res = await fetch(`${base}/pro/__skew/health`)
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean, version: string }
    expect(body.ok).toBe(true)
    expect(body.version).toBe(DEPLOYMENT_ID)
  }, 30000)

  it('does NOT register the health handler at the default root /__skew prefix', async () => {
    // This SSR app renders app.vue for any unmatched path (HTTP 200 HTML), so a
    // 404 isn't the signal — the signal is that the root path is NOT the skew
    // health JSON handler. It only exists under the auto-detected /pro prefix.
    const res = await fetch(`${base}/__skew/health`)
    expect(res.headers.get('content-type') || '').not.toContain('application/json')
    const body = await res.text()
    expect(body).not.toContain('"ok":true')
  }, 30000)

  it('sets the auto-namespaced __nkpv_pro version cookie on document requests', async () => {
    // Cookie is only set on document navigations (sec-fetch-dest: document).
    const res = await fetch(`${base}/`, { headers: { 'sec-fetch-dest': 'document' } })
    const setCookies = res.headers.getSetCookie()
    const skewCookie = setCookies.find(c => c.startsWith('__nkpv'))
    expect(skewCookie).toBeDefined()
    // Auto-derived from the /pro mount, not the bare default.
    expect(skewCookie).toMatch(/^__nkpv_pro=/)
    expect(skewCookie).toContain(DEPLOYMENT_ID)
    // The bare default name must not leak through.
    expect(setCookies.some(c => c.startsWith('__nkpv='))).toBe(false)
  }, 30000)
})
