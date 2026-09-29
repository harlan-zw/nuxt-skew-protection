import type { ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build, cleanFixture, sleep, startServer, stopServer } from './utils'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixtureDir = resolve(__dirname, '../fixtures/base-url')
const port = 3352 // unique port
const base = `http://localhost:${port}`
const DEPLOYMENT_ID = 'base-url-v1'
const RE_BASE_PATH = /basePath:"([^"]+)"/

// The fixture sets `app.baseURL: '/app/'`. The client reads `basePath` from the
// public runtime config and requests it verbatim, so every endpoint the client
// can call must answer at exactly that path.
describe.sequential('app.baseURL', () => {
  let serverProc: ChildProcess | null = null
  let basePath = ''

  beforeAll(async () => {
    cleanFixture(fixtureDir)
    await build(fixtureDir, DEPLOYMENT_ID)
    serverProc = await startServer(fixtureDir, port)
    await sleep(2000)
    const html = await fetch(`${base}/app/`).then(r => r.text())
    basePath = html.match(RE_BASE_PATH)?.[1] || ''
  }, 120000)

  afterAll(async () => {
    if (serverProc)
      await stopServer(serverProc)
  })

  it('exposes the baseURL prefixed endpoint path to the client', () => {
    expect(basePath).toBe('/app/__skew')
  })

  it('serves the health endpoint at the client path', async () => {
    const res = await fetch(`${base}${basePath}/health`)
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean, version: string }
    expect(body.ok).toBe(true)
    expect(body.version).toBe(DEPLOYMENT_ID)
  }, 30000)

  it('serves the SSE stream at the client path', async () => {
    const controller = new AbortController()
    const res = await fetch(`${base}${basePath}/sse`, { signal: controller.signal })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    controller.abort()
  }, 30000)

  it('does not double the baseURL', async () => {
    const res = await fetch(`${base}/app/app/__skew/health`)
    expect(res.headers.get('content-type') || '').not.toContain('application/json')
  }, 30000)
})
