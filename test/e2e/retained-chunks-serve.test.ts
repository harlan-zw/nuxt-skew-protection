import { exec } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build, cleanFixture, startServer, stopServer } from './utils'

const execAsync = promisify(exec)
const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixtureDir = resolve(__dirname, '../fixtures/node')
const appPath = resolve(fixtureDir, 'app.vue')
const port = 3354 // unique port

// Written verbatim rather than patched into whatever is on disk. The reproduction
// needs the first build to emit a chunk the second one cannot, so both bodies
// have to be fixed, not derived from the fixture's current state.
function page(body: string) {
  return `<script setup lang="ts">
import { ref } from 'vue'

const version = ref('${body}')
</script>

<template>
  <div>
    <h1>{{ version }}</h1>
  </div>
</template>
`
}

async function publicChunks(): Promise<string[]> {
  const { stdout } = await execAsync('ls .output/public/_nuxt/*.js | xargs -n1 basename', { cwd: fixtureDir })
  return stdout.trim().split('\n').filter(Boolean)
}

/**
 * A stale document must still load its chunks after the next deploy.
 *
 * Retention writes the previous build's chunks back into `.output/public`, but
 * nitro freezes its public asset manifest while rollup runs and the node server
 * serves nothing outside it. Restoring after that point left files on disk that
 * returned 404, which made retention a no-op on every node-based preset.
 */
describe('retained chunks on the node preset', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let original: string
  let firstBuildChunks: string[]

  beforeAll(async () => {
    original = await readFile(appPath, 'utf-8')
    cleanFixture(fixtureDir)

    await writeFile(appPath, page('first deploy'), 'utf-8')
    await build(fixtureDir, 'dpl-retained-1')
    firstBuildChunks = await publicChunks()

    await writeFile(appPath, page('second deploy, entirely different'), 'utf-8')
    await build(fixtureDir, 'dpl-retained-2')

    // A server left behind by an interrupted run answers 404 for everything.
    await execAsync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`)
    server = await startServer(fixtureDir, port)
  }, 300000)

  afterAll(async () => {
    if (server)
      await stopServer(server)
    await writeFile(appPath, original, 'utf-8')
    cleanFixture(fixtureDir)
  })

  // Guards the two below. If both builds emit the same chunks there is nothing
  // to retain, and the assertions would pass without proving anything.
  it('retains a chunk the second build did not emit', async () => {
    const afterSecondBuild = await publicChunks()
    expect(afterSecondBuild.length).toBeGreaterThan(firstBuildChunks.length)
    expect(firstBuildChunks.every(chunk => afterSecondBuild.includes(chunk))).toBe(true)
  })

  it('serves every chunk the first build produced', async () => {
    const statuses = await Promise.all(firstBuildChunks.map(async chunk =>
      [chunk, (await fetch(`http://localhost:${port}/_nuxt/${chunk}`)).status] as const))
    expect(statuses.filter(([, status]) => status !== 200)).toEqual([])
  })

  it('serves every file in the public build directory', async () => {
    const statuses = await Promise.all((await publicChunks()).map(async chunk =>
      [chunk, (await fetch(`http://localhost:${port}/_nuxt/${chunk}`)).status] as const))
    expect(statuses.filter(([, status]) => status !== 200)).toEqual([])
  })
})
