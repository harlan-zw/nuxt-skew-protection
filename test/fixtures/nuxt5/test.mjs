import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'

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
  const server = spawn(process.execPath, ['.output/server/index.mjs'], {
    cwd: import.meta.dirname,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      NITRO_PORT: String(port),
      NITRO_HOST: '127.0.0.1',
    },
    stdio: 'inherit',
  })

  try {
    const response = await waitForServer(server, origin)
    const html = await response.text()
    assert.match(html, /Nuxt Skew Protection Nitro 3/)
    assert.match(html, /id="connection-count">1</)
    assert.match(html, /id="alias-app">true</)
    const botHtml = await fetch(origin, { headers: { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' } }).then(response => response.text())
    const botConnections = 0
    assert.match(botHtml, new RegExp(`id="connection-count">${botConnections}<`))
    const diagnostic = await fetch(`${origin}/api/diagnostic`).then(response => response.json())
    assert.equal(diagnostic.siteConfigUrl, 'https://skew.example.com')
    const document = await fetch(origin, { headers: { 'sec-fetch-dest': 'document' } })
    assert.match(document.headers.get('set-cookie') || '', /__nkpv=nuxt5-fixture-v1/)
    const cached = await fetch(`${origin}/cacheable`, { headers: { 'sec-fetch-dest': 'document' } })
    assert.match(cached.headers.get('cache-control') || '', /s-maxage=300/)
    assert.deepEqual(cached.headers.getSetCookie(), ['session=kept; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Path=/'])
    const authenticated = await fetch(`${origin}/cacheable`, {
      headers: { 'sec-fetch-dest': 'document', 'authorization': 'Bearer fixture' },
    })
    assert.ok(authenticated.headers.getSetCookie().some(cookie => cookie.startsWith('__nkpv=')))
    const asset = html.match(/src="([^"]+.js)"/)?.[1]
    assert.ok(asset, 'The document includes a JavaScript asset')
    const assetResponse = await fetch(new URL(asset, origin), { headers: { cookie: '__nkpv=previous-deployment' } })
    assert.equal(assetResponse.status, 200)

    const worker = await fetch(`${origin}/_nuxt-skew-sw.js`)
    assert.equal(worker.status, 200)
    assert.match(worker.headers.get('content-type') || '', /javascript/)
    assert.match(await worker.text(), /addEventListener/)

    const health = await fetch(`${origin}/__skew/health`).then(response => response.json())
    assert.equal(health.ok, true)
    assert.equal(health.version, 'nuxt5-fixture-v1')

    const context = await fetch(`${origin}/api/compat`, {
      headers: {
        cookie: '__nkpv=client-v4',
      },
    }).then(response => response.json())
    assert.equal(context.skewVersion, 'client-v4')
    assert.equal(context.clientVersion, 'client-v4')
    assert.equal(context.outdated, true)
  }
  finally {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit')
      server.kill()
      await exited
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
