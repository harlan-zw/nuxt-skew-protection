import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

async function waitForServer(server, origin) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (server.exitCode !== null)
      throw new Error(`Nuxt 5 server exited with code ${server.exitCode}`)

    const response = await fetch(origin, {
      signal: AbortSignal.timeout(1_000),
    }).catch(() => {
      // Connection failures are expected while the server starts.
      return null
    })
    if (response?.ok)
      return response

    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Nuxt 5 server did not start')
}

async function main() {
  const portServer = createServer()
  portServer.listen(0, '127.0.0.1')
  await once(portServer, 'listening')
  const port = portServer.address().port
  portServer.close()
  await once(portServer, 'close')

  const origin = `http://127.0.0.1:${port}`
  const fixtureTypes = await readFile(new URL('.nuxt/types/nuxt-skew-protection-nitro.d.ts', import.meta.url), 'utf8')
  const nitroManifest = JSON.parse(await readFile(new URL('.output/nitro.json', import.meta.url), 'utf8'))
  const nitroServerEntries = await readdir(new URL('.output/server', import.meta.url), {
    recursive: true,
    withFileTypes: true,
  })
  const nitroServer = (await Promise.all(
    nitroServerEntries
      .filter(entry => entry.isFile() && entry.name.endsWith('.mjs'))
      .map(entry => readFile(resolve(entry.parentPath, entry.name), 'utf8')),
  )).join('\n')

  assert.equal(nitroManifest.versions.nitro, '3.0.260610-beta')
  assert.match(fixtureTypes, /declare module 'nitro\/types'/)
  assert.match(fixtureTypes, /interface NitroRuntimeHooks/)
  assert.match(fixtureTypes, /'skew:subscribe-stats'/)
  assert.match(fixtureTypes, /import\('nitro\/h3'\)\.H3Event/)
  assert.match(fixtureTypes, /declare module 'srvx'/)
  assert.match(fixtureTypes, /interface ServerRequestContext/)
  assert.match(fixtureTypes, /skewVersion\?: string/)
  assert.doesNotMatch(fixtureTypes, /nitropack/)
  assert.doesNotMatch(nitroServer, /nitropack\/runtime/)

  const server = spawn(process.execPath, ['.output/server/index.mjs'], {
    cwd: import.meta.dirname,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
    },
    stdio: 'inherit',
  })

  try {
    const response = await waitForServer(server, origin)
    assert.match(await response.text(), /Nuxt Skew Protection Nitro 3/)

    const health = await fetch(`${origin}/__skew/health`).then(response => response.json())
    assert.equal(health.ok, true)
    assert.equal(health.version, 'nuxt5-fixture-v1')

    const context = await fetch(`${origin}/api/compat`, {
      headers: {
        cookie: '__nkpv=client-v4',
      },
    }).then(response => response.json())
    assert.equal(context.skewVersion, 'client-v4')
  }
  finally {
    server.kill()
    if (server.exitCode === null)
      await new Promise(resolve => server.once('exit', resolve))
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
