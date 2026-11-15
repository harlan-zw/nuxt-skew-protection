import type { WranglerExecution } from '../../src/unstorage/cloudflare-kv-wrangler-driver'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createCloudflareKVWranglerDriver } from '../../src/unstorage/cloudflare-kv-wrangler-driver'
import { readWranglerKVNamespaces, selectCloudflareKVNamespace } from '../../src/unstorage/utils'
import { createAssetManager } from '../../src/utils/version-manager'

function successfulExecution(stdout: Uint8Array | string = ''): WranglerExecution {
  return {
    exitCode: 0,
    stderr: Buffer.alloc(0),
    stdout: Buffer.from(stdout),
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
    ], 'SKEW_PROTECTION')).toThrow(/Available bindings: CACHE/)
  })

  it('rejects duplicate requested bindings', () => {
    expect(() => selectCloudflareKVNamespace([
      { binding: 'SKEW_PROTECTION', id: 'first-id' },
      { binding: 'SKEW_PROTECTION', id: 'second-id' },
    ], 'SKEW_PROTECTION')).toThrow(/multiple/i)
  })

  it.each([
    ['json', JSON.stringify({ kv_namespaces: [{ binding: 'SKEW_PROTECTION', id: 'json-id' }] }), 'json-id'],
    ['jsonc', `{
      // Dedicated storage for retained assets.
      "kv_namespaces": [
        { "binding": "SKEW_PROTECTION", "id": "jsonc-id", },
      ],
    }`, 'jsonc-id'],
    ['toml', `
      [[kv_namespaces]]
      id = "toml-id"
      binding = "SKEW_PROTECTION"
    `, 'toml-id'],
  ])('reads Wrangler %s configuration', async (extension, contents, id) => {
    const directory = await mkdtemp(join(tmpdir(), 'nuxt-skew-protection-config-'))
    const path = join(directory, `wrangler.${extension}`)
    await writeFile(path, contents)

    try {
      await expect(readWranglerKVNamespaces(path)).resolves.toEqual([
        { binding: 'SKEW_PROTECTION', id },
      ])
    }
    finally {
      await rm(directory, { recursive: true })
    }
  })
})

describe('cloudflare KV Wrangler driver', () => {
  it.each(['[]', '[{"name":"skew:missing-other"}]'])('returns null for an absent key with listed keys %s', async (keys) => {
    const execute = vi.fn(async (args: readonly string[]) => args.includes('list')
      ? successfulExecution(keys)
      : { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from('404: Not Found') })
    const driver = createCloudflareKVWranglerDriver(execute)({ namespaceId: 'namespace-id', base: 'skew:' })

    await expect(driver.getItem?.('missing')).resolves.toBeNull()
  })

  it('creates and reads the first version manifest in an empty namespace', async () => {
    const values = new Map<string, string>()
    const execute = async (args: readonly string[]): Promise<WranglerExecution> => {
      if (args[2] === 'list')
        return successfulExecution(JSON.stringify([...values.keys()].map(name => ({ name }))))
      const key = args[3]!
      if (args[2] === 'put') {
        values.set(key, await readFile(args[args.indexOf('--path') + 1]!, 'utf8'))
        return successfulExecution()
      }
      const value = values.get(key)
      return value === undefined
        ? { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from('404: Not Found') }
        : successfulExecution(value)
    }
    const manager = createAssetManager({
      driver: createCloudflareKVWranglerDriver(execute)({ namespaceId: 'namespace-id', base: 'skew:' }),
    })

    await manager.updateVersionsManifest('first-build', ['_nuxt/entry.hash.js'])

    expect(await manager.getManifest()).toMatchObject({
      current: 'first-build',
      versions: { 'first-build': { assets: ['_nuxt/entry.hash.js'] } },
    })
  })

  it.each(['list', 'get'])('preserves %s failures for JSON reads', async (operation) => {
    for (const message of ['authentication failed', 'namespace 404: Not Found', 'network connection failed']) {
      const execute = async (args: readonly string[]) => args[2] === operation
        ? { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(message) }
        : successfulExecution('[{"name":"manifest"}]')
      const driver = createCloudflareKVWranglerDriver(execute)({ namespaceId: 'namespace-id' })

      await expect(driver.getItem?.('manifest')).rejects.toThrow(message)
    }
  })

  it('preserves process execution failures', async () => {
    const error = new Error('Unable to run Wrangler')
    const driver = createCloudflareKVWranglerDriver(async () => {
      throw error
    })({ namespaceId: 'namespace-id' })

    await expect(driver.getItem?.('manifest')).rejects.toBe(error)
  })

  it('rejects malformed stored JSON', async () => {
    const execute = async (args: readonly string[]) => successfulExecution(args[2] === 'list'
      ? '[{"name":"manifest"}]'
      : '{invalid json')
    const driver = createCloudflareKVWranglerDriver(execute)({ namespaceId: 'namespace-id' })

    await expect(driver.getItem?.('manifest')).rejects.toBeInstanceOf(SyntaxError)
  })

  it('returns null for Wrangler v4 missing-value output', async () => {
    const execute = vi.fn(async (args: readonly string[]) => successfulExecution(args[2] === 'list'
      ? '[{"name":"missing"}]'
      : 'Value not found\n'))
    const driver = createCloudflareKVWranglerDriver(execute)({ namespaceId: 'namespace-id' })

    await expect(driver.getItem?.('missing')).resolves.toBeNull()
    expect(execute).toHaveBeenCalledWith([
      'kv',
      'key',
      'get',
      'missing',
      '--namespace-id',
      'namespace-id',
      '--remote',
      '--text',
    ])
  })

  it('preserves raw bytes returned by Wrangler', async () => {
    const bytes = Uint8Array.from([0, 255, 128, 10, 13])
    const execute = vi.fn(async (args: readonly string[]) => {
      if (args.includes('list'))
        return successfulExecution('[{"name":"skew:asset.wasm"}]')
      return successfulExecution(bytes)
    })
    const driver = createCloudflareKVWranglerDriver(execute)({ namespaceId: 'namespace-id', base: 'skew:' })

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

  it('writes raw bytes through a temporary file and removes it', async () => {
    const bytes = Uint8Array.from([0, 255, 128, 10, 13])
    let temporaryPath = ''
    let written: Buffer | undefined
    const execute = vi.fn(async (args: readonly string[]) => {
      temporaryPath = args[args.indexOf('--path') + 1] || ''
      written = await readFile(temporaryPath)
      return successfulExecution()
    })
    const driver = createCloudflareKVWranglerDriver(execute)({ namespaceId: 'namespace-id' })

    await driver.setItemRaw?.('asset.wasm', bytes)

    expect(written).toEqual(Buffer.from(bytes))
    await expect(access(temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(dirname(temporaryPath))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('cleans temporary files after Wrangler fails', async () => {
    let temporaryPath = ''
    const execute = vi.fn(async (args: readonly string[]) => {
      temporaryPath = args[args.indexOf('--path') + 1] || ''
      return {
        exitCode: 1,
        stderr: Buffer.from('authentication failed'),
        stdout: Buffer.alloc(0),
      }
    })
    const driver = createCloudflareKVWranglerDriver(execute)({ namespaceId: 'namespace-id' })

    await expect(driver.setItemRaw?.('asset.wasm', Buffer.from('asset'))).rejects.toThrow(/authentication failed/)
    await expect(access(temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(dirname(temporaryPath))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('passes keys as argv without shell parsing', async () => {
    const execute = vi.fn(async () => successfulExecution('[]'))
    const driver = createCloudflareKVWranglerDriver(execute)({ namespaceId: 'namespace-id' })
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
    const driver = createCloudflareKVWranglerDriver(execute)({ namespaceId: 'namespace-id' })

    await expect(driver.getKeys?.()).rejects.toThrow(/authentication failed/)
  })
})
