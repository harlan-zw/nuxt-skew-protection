import type { ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build, cleanFixture, startServer, stopServer } from './utils'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixtureDir = resolve(__dirname, '../fixtures/html-cache')
const port = 3352 // unique port

/** A browser asking for a page, which is the only traffic the policy claims. */
function document(path: string, headers: Record<string, string> = {}) {
  return fetch(`http://localhost:${port}${path}`, {
    headers: { 'sec-fetch-dest': 'document', 'accept': 'text/html', ...headers },
    redirect: 'manual',
  })
}

function versionCookies(response: Response): string[] {
  return response.headers.getSetCookie().filter(cookie => cookie.startsWith('__nkpv='))
}

describe('html caching without a module option', () => {
  let server: ChildProcess

  beforeAll(async () => {
    cleanFixture(fixtureDir)
    await build(fixtureDir, 'dpl-html-cache-1')
    server = await startServer(fixtureDir, port)
  }, 180000)

  afterAll(async () => {
    if (server)
      await stopServer(server)
    cleanFixture(fixtureDir)
  })

  it('drops the version cookie so a shared cache can store the document', async () => {
    const response = await document('/cached')
    expect(response.headers.get('cache-control')).toContain('s-maxage=300')
    expect(versionCookies(response)).toEqual([])
  })

  it('leaves the version cookie on a route that asked for nothing', async () => {
    const response = await document('/')
    expect(versionCookies(response)).toHaveLength(1)
  })

  it('leaves the version cookie on a route the app marked private', async () => {
    const response = await document('/private')
    expect(versionCookies(response)).toHaveLength(1)
  })

  it('keeps the document unstorable when the request carries a cookie', async () => {
    const response = await document('/cached', { cookie: 'session=abc' })
    expect(versionCookies(response)).toHaveLength(1)
  })

  it('keeps the document unstorable when the request is token-authenticated', async () => {
    const response = await document('/cached', { authorization: 'Bearer abc' })
    expect(versionCookies(response)).toHaveLength(1)
  })
})
