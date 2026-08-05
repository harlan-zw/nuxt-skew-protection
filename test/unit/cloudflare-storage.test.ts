import type { WranglerExecution } from '../../src/unstorage/cloudflare-kv-wrangler-driver'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createCloudflareKVWranglerDriver,
} from '../../src/unstorage/cloudflare-kv-wrangler-driver'
import {
  readWranglerKVNamespaces,
  selectCloudflareKVNamespace,
} from '../../src/unstorage/utils'

function successfulExecution(stdout: Uint8Array | string = ''): WranglerExecution {
  return {
    exitCode: 0,
    stderr: Buffer.alloc(0),
    stdout: typeof stdout === 'string' ? Buffer.from(stdout) : Buffer.from(stdout),
  }
}

describe('cloudflare KV namespace resolution', () => {
  it('selects only the requested binding', () => {
    expect(selectCloudflareKVNamespace([
      { binding: 'CACHE', id: 'cache-id' },
      { binding: 'SKEW_PROTECTION', id: 'skew-id' },
    ], 'SKEW_PROTECTION')).toBe('skew-id')
  })

  it('rejects an unrelated binding instead of selecting the first namespace', () => {
    expect(() => selectCloudflareKVNamespace([
      { binding: 'CACHE', id: 'cache-id' },
    ], 'SKEW_PROTECTION')).toThrow(/SKEW_PROTECTION/)
  })

  it('rejects duplicate requested bindings', () => {
    expect(() => selectCloudflareKVNamespace([
      { binding: 'SKEW_PROTECTION', id: 'first-id' },
      { binding: 'SKEW_PROTECTION', id: 'second-id' },
    ], 'SKEW_PROTECTION')).toThrow(/multiple/i)
  })

  it('reads comments and trailing commas from wrangler.jsonc', async () => {
    const path = join(tmpdir(), `nuxt-skew-protection-${crypto.randomUUID()}.jsonc`)
    await writeFile(path, `{
      // Dedicated storage for retained assets.
      "kv_namespaces": [
        { "binding": "SKEW_PROTECTION", "id": "jsonc-id", },
      ],
    }`)

    try {
      await expect(readWranglerKVNamespaces(path)).resolves.toEqual([
        { binding: 'SKEW_PROTECTION', id: 'jsonc-id' },
      ])
    }
    finally {
      await unlink(path)
    }
  })

  it('reads TOML regardless of property order', async () => {
    const path = join(tmpdir(), `nuxt-skew-protection-${crypto.randomUUID()}.toml`)
    await writeFile(path, `
      [[kv_namespaces]]
      id = "toml-id"
      binding = "SKEW_PROTECTION"
    `)

    try {
      await expect(readWranglerKVNamespaces(path)).resolves.toEqual([
        { binding: 'SKEW_PROTECTION', id: 'toml-id' },
      ])
    }
    finally {
      await unlink(path)
    }
  })
})

describe('cloudflare KV Wrangler driver', () => {
  it('returns null for Wrangler v4 missing-value output', async () => {
    const execute = vi.fn(async () => successfulExecution('Value not found\n'))
    const factory = createCloudflareKVWranglerDriver(execute)
    const driver = factory({ namespaceId: 'namespace-id' })

    await expect(driver.getItem?.('missing')).resolves.toBeNull()
    expect(execute).toHaveBeenCalledOnce()
  })

  it('preserves raw bytes returned by Wrangler', async () => {
    const bytes = Uint8Array.from([0, 255, 128, 10, 13])
    const execute = vi.fn(async (args: readonly string[]) => {
      if (args.includes('list'))
        return successfulExecution('[{"name":"skew:asset.wasm"}]')
      return successfulExecution(bytes)
    })
    const factory = createCloudflareKVWranglerDriver(execute)
    const driver = factory({ namespaceId: 'namespace-id', base: 'skew:' })

    await expect(driver.getItemRaw?.('asset.wasm')).resolves.toEqual(Buffer.from(bytes))
    expect(execute).toHaveBeenLastCalledWith([
      'kv',
      'key',
      'get',
      'skew:asset.wasm',
      '--namespace-id',
      'namespace-id',
      '--remote',
    ])
  })

  it('writes raw bytes through a temporary file', async () => {
    const bytes = Uint8Array.from([0, 255, 128, 10, 13])
    let written: Buffer | undefined
    const execute = vi.fn(async (args: readonly string[]) => {
      const pathFlag = args.indexOf('--path')
      if (pathFlag !== -1)
        written = await readFile(args[pathFlag + 1])
      return successfulExecution()
    })
    const factory = createCloudflareKVWranglerDriver(execute)
    const driver = factory({ namespaceId: 'namespace-id' })

    await driver.setItemRaw?.('asset.wasm', bytes)

    expect(written).toEqual(Buffer.from(bytes))
  })

  it('passes keys as argv without a shell', async () => {
    const execute = vi.fn(async () => successfulExecution('[]'))
    const factory = createCloudflareKVWranglerDriver(execute)
    const driver = factory({ namespaceId: 'namespace-id' })
    const key = 'asset"; touch /tmp/escaped'

    await driver.getKeys?.(key)

    expect(execute).toHaveBeenCalledWith([
      'kv',
      'key',
      'list',
      '--prefix',
      key,
      '--namespace-id',
      'namespace-id',
      '--remote',
    ])
  })

  it('surfaces Wrangler failures with stderr', async () => {
    const execute = vi.fn(async () => ({
      exitCode: 1,
      stderr: Buffer.from('authentication failed'),
      stdout: Buffer.alloc(0),
    }))
    const factory = createCloudflareKVWranglerDriver(execute)
    const driver = factory({ namespaceId: 'namespace-id' })

    await expect(driver.getKeys?.()).rejects.toThrow(/authentication failed/)
  })
})
