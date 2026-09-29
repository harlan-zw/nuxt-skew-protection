import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { build, cleanFixture } from './utils'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

function readOutput(fixtureDir: string) {
  const output = join(fixtureDir, '.output')
  const files = readdirSync(output, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.m?js$/.test(entry.name))
    .map(entry => join(entry.parentPath, entry.name))
  return {
    server: readFileSync(join(output, 'server/chunks/nitro/nitro.mjs'), 'utf-8'),
    client: files.filter(file => file.includes('/public/')).map(file => readFileSync(file, 'utf-8')).join('\n'),
    all: files.map(file => readFileSync(file, 'utf-8')).join('\n'),
  }
}

// Nuxt deep clones nuxt.config while loading it. An adapter set in
// `updateStrategy` must survive that clone, validate, and ship only its
// public config to the client.
describe.sequential('adapter in nuxt.config', () => {
  it('builds with pusherAdapter()', async () => {
    const fixtureDir = resolve(__dirname, '../fixtures/pusher')
    cleanFixture(fixtureDir)
    process.env.PUSHER_KEY = 'test-key'
    process.env.PUSHER_APP_ID = 'test-app'
    process.env.PUSHER_SECRET = 'test-secret'
    await build(fixtureDir, 'pusher-v1')
    const output = readOutput(fixtureDir)
    expect(output.server).toContain('"adapterName": "pusher"')
    expect(output.client).toContain('test-key')
    expect(output.all).not.toContain('test-secret')
  }, 300000)

  it('builds with ablyAdapter()', async () => {
    const fixtureDir = resolve(__dirname, '../fixtures/ably')
    cleanFixture(fixtureDir)
    process.env.ABLY_KEY = 'test.key:secret'
    await build(fixtureDir, 'ably-v1')
    const output = readOutput(fixtureDir)
    expect(output.server).toContain('"adapterName": "ably"')
    expect(output.client).toContain('/api/ably-token')
    expect(output.all).not.toContain('test.key:secret')
  }, 300000)

  it('builds a custom adapter and runs its broadcast', async () => {
    const fixtureDir = resolve(__dirname, '../fixtures/adapter')
    cleanFixture(fixtureDir)
    rmSync(join(fixtureDir, '.broadcast'), { force: true })
    await build(fixtureDir, 'file-v1')
    const output = readOutput(fixtureDir)
    expect(output.server).toContain('"adapterName": "file"')
    expect(output.client).toContain('from=file-adapter-web')
    expect(output.client).toContain('/file-adapter-events')
    expect(readFileSync(join(fixtureDir, '.broadcast'), 'utf-8')).toBe('file-v1')
  }, 300000)
})
