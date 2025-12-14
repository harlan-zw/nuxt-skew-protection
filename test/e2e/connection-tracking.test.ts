import type { ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { build, cleanFixture, sleep, startServer, stopServer } from './utils'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixtureDir = resolve(__dirname, '../fixtures/websocket')
const port = 3336

interface WsConn {
  ws: WebSocket
  messages: any[]
  waitForStats: (predicate?: (msg: any) => boolean) => Promise<any>
}

function createWs(version?: string): Promise<WsConn> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {}
    if (version)
      headers.cookie = `__nkpv=${version}`

    const ws = new WebSocket(`ws://localhost:${port}/_skew/ws`, { headers })
    const messages: any[] = []
    const statsWaiters: Array<{ predicate?: (msg: any) => boolean, resolve: (msg: any) => void }> = []

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      messages.push(msg)
      if (msg.type === 'stats') {
        const waiter = statsWaiters.find(w => !w.predicate || w.predicate(msg))
        if (waiter) {
          statsWaiters.splice(statsWaiters.indexOf(waiter), 1)
          waiter.resolve(msg)
        }
      }
    })

    const waitForStats = (predicate?: (msg: any) => boolean, timeout = 5000): Promise<any> => {
      const existing = messages.filter(m => m.type === 'stats').find(m => !predicate || predicate(m))
      if (existing)
        return Promise.resolve(existing)
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          const statsMessages = messages.filter(m => m.type === 'stats')
          rej(new Error(`waitForStats timeout. Stats messages received: ${JSON.stringify(statsMessages)}`))
        }, timeout)
        statsWaiters.push({
          predicate,
          resolve: (msg) => {
            clearTimeout(timer)
            res(msg)
          },
        })
      })
    }

    ws.on('open', () => resolve({ ws, messages, waitForStats }))
    ws.on('error', reject)

    setTimeout(() => reject(new Error('WS connection timeout')), 5000)
  })
}

describe.sequential('connection-tracking', () => {
  let serverProc: ChildProcess | null = null
  let activeConns: WsConn[] = []

  beforeAll(async () => {
    cleanFixture(fixtureDir)
    await build(fixtureDir, 'conn-tracking-v1')
    serverProc = await startServer(fixtureDir, port)
    await sleep(2000)
  }, 120000)

  afterEach(async () => {
    // Close all connections from the test
    for (const conn of activeConns) {
      conn.ws.close()
    }
    activeConns = []
    await sleep(500) // Wait for close broadcasts
  })

  afterAll(async () => {
    if (serverProc)
      await stopServer(serverProc)
  })

  it('broadcasts stats when connection opens', async () => {
    const conn = await createWs()
    activeConns.push(conn)

    const statsMsg = await conn.waitForStats()

    expect(conn.messages[0].type).toBe('connected')
    expect(statsMsg.total).toBe(1)
  }, 10000)

  it('tracks multiple connections with correct totals', async () => {
    const conn1 = await createWs()
    activeConns.push(conn1)
    await conn1.waitForStats()

    const conn2 = await createWs()
    activeConns.push(conn2)
    await conn2.waitForStats(m => m.total === 2)

    const conn3 = await createWs()
    activeConns.push(conn3)

    const stats = await conn3.waitForStats(m => m.total === 3)
    expect(stats.total).toBe(3)
  }, 15000)

  it('broadcasts updated stats when connection closes', async () => {
    const conn1 = await createWs()
    activeConns.push(conn1)
    await conn1.waitForStats()

    const conn2 = await createWs()
    activeConns.push(conn2)
    await conn2.waitForStats(m => m.total === 2)

    // Close conn1 (remove from activeConns so afterEach doesn't double-close)
    activeConns = activeConns.filter(c => c !== conn1)
    conn1.ws.close()

    const stats = await conn2.waitForStats(m => m.total === 1)
    expect(stats.total).toBe(1)
  }, 15000)

  it('tracks versions from cookie', async () => {
    const conn1 = await createWs('v1.0.0')
    activeConns.push(conn1)
    await conn1.waitForStats()

    const conn2 = await createWs('v1.0.0')
    activeConns.push(conn2)
    await conn2.waitForStats(m => m.total === 2)

    const conn3 = await createWs('v2.0.0')
    activeConns.push(conn3)

    const stats = await conn3.waitForStats(m => m.total === 3)
    expect(stats.total).toBe(3)
    expect(stats.versions['v1.0.0']).toBe(2)
    expect(stats.versions['v2.0.0']).toBe(1)
  }, 15000)
})
