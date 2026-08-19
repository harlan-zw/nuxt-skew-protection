import type { ChildProcess } from 'node:child_process'
import { exec, spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const execAsync = promisify(exec)
const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixtureDir = resolve(__dirname, '../fixtures/html-cache-cloudflare')
const port = 3353 // unique port

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function document(path: string, headers: Record<string, string> = {}) {
  return fetch(`http://localhost:${port}${path}`, {
    headers: { 'sec-fetch-dest': 'document', 'accept': 'text/html', ...headers },
    redirect: 'manual',
  })
}

function versionCookies(response: Response): string[] {
  return response.headers.getSetCookie().filter(cookie => cookie.startsWith('__nkpv='))
}

async function startWrangler(): Promise<ChildProcess> {
  await execAsync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`)
  const proc = spawn('npx', [
    'wrangler',
    'dev',
    '.output/server/index.mjs',
    '--assets',
    '.output/public',
    '--port',
    String(port),
    // Nitro emits today's date, which a slightly older local workerd refuses.
    '--compatibility-date',
    '2026-08-01',
  ], { cwd: fixtureDir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })

  for (let attempt = 0; attempt < 30; attempt++) {
    const ready = await fetch(`http://localhost:${port}/`).then(() => true).catch(() => false)
    if (ready)
      return proc
    await sleep(2000)
  }
  throw new Error('wrangler dev did not start')
}

describe('html caching on cloudflare', () => {
  let server: ChildProcess

  beforeAll(async () => {
    rmSync(resolve(fixtureDir, '.output'), { recursive: true, force: true })
    rmSync(resolve(fixtureDir, '.nuxt'), { recursive: true, force: true })
    rmSync(resolve(fixtureDir, '.skew-storage'), { recursive: true, force: true })
    await execAsync('pnpm build', { cwd: fixtureDir })
    server = await startWrangler()
  }, 300000)

  afterAll(async () => {
    server?.kill('SIGTERM')
    rmSync(resolve(fixtureDir, '.output'), { recursive: true, force: true })
    rmSync(resolve(fixtureDir, '.nuxt'), { recursive: true, force: true })
    rmSync(resolve(fixtureDir, '.skew-storage'), { recursive: true, force: true })
    rmSync(resolve(fixtureDir, '.wrangler'), { recursive: true, force: true })
  })

  it('drops the version cookie so a shared cache can store the document', async () => {
    const response = await document('/cached')
    expect(response.headers.get('cache-control')).toContain('s-maxage=300')
    expect(versionCookies(response)).toEqual([])
  })

  // The case this feature exists for. Googlebot sends no sec-fetch-dest, so a
  // policy keyed on that header alone left crawlers as the only cache HIT.
  it('drops the cookie for a crawler that sends no sec-fetch-dest', async () => {
    const response = await fetch(`http://localhost:${port}/cached`, { headers: { accept: 'text/html' } })
    expect(versionCookies(response)).toEqual([])
  })

  it('leaves the version cookie on a route that asked for nothing', async () => {
    expect(versionCookies(await document('/'))).toHaveLength(1)
  })

  it('leaves the version cookie on a route the app marked private', async () => {
    expect(versionCookies(await document('/private'))).toHaveLength(1)
  })

  it('keeps the document unstorable when the request carries a cookie', async () => {
    expect(versionCookies(await document('/cached', { cookie: 'session=abc' }))).toHaveLength(1)
  })

  it('keeps the document unstorable when the request is token-authenticated', async () => {
    expect(versionCookies(await document('/cached', { authorization: 'Bearer abc' }))).toHaveLength(1)
  })

  // What `assetRecovery` promises, and the reason it is Cloudflare-only.
  // Workers Assets serves the public directory, which is where retained chunks
  // are restored to. The node preset embeds a manifest in `nitro.mjs` and 404s
  // anything absent from it, restored or not.
  it('serves every build asset in the public directory', async () => {
    const { stdout } = await execAsync('ls .output/public/_nuxt/*.js | xargs -n1 basename', { cwd: fixtureDir })
    const chunks = stdout.trim().split('\n').filter(Boolean)
    expect(chunks.length).toBeGreaterThan(0)

    const statuses = await Promise.all(
      chunks.map(chunk => fetch(`http://localhost:${port}/_nuxt/${chunk}`).then(r => r.status)),
    )
    expect(statuses.every(status => status === 200)).toBe(true)
  })
})
