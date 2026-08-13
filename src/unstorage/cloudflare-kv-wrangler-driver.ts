import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineDriver } from 'unstorage'

export interface CloudflareKVWranglerOptions {
  namespaceId: string
  /** Use local KV storage instead of remote. */
  local?: boolean
  /** Prefix for all keys. */
  base?: string
}

export interface WranglerExecution {
  stdout: Buffer
  stderr: Buffer
  exitCode: number
}

export type ExecuteWrangler = (args: readonly string[]) => Promise<WranglerExecution>

const executeWrangler: ExecuteWrangler = args => new Promise((resolve, reject) => {
  const child = spawn('wrangler', [...args], {
    shell: false,
    windowsHide: true,
  })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []

  child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
  child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
  child.once('error', error => reject(new Error(
    '[cloudflare-kv-wrangler] Unable to run Wrangler. Install Wrangler v4 in the project and authenticate the build environment.',
    { cause: error },
  )))
  child.once('close', code => resolve({
    exitCode: code ?? 1,
    stderr: Buffer.concat(stderr),
    stdout: Buffer.concat(stdout),
  }))
})

function assertSuccess(
  result: WranglerExecution,
  args: readonly string[],
): WranglerExecution {
  if (result.exitCode === 0)
    return result

  const stderr = result.stderr.toString('utf8').trim()
  throw new Error([
    `[cloudflare-kv-wrangler] Wrangler exited with status ${result.exitCode}.`,
    `Command: wrangler ${args.map(arg => JSON.stringify(arg)).join(' ')}`,
    stderr ? `stderr: ${stderr}` : 'Wrangler did not provide an error message.',
  ].join('\n'))
}

function parseListedKeys(stdout: Buffer): string[] {
  const parsed: unknown = JSON.parse(stdout.toString('utf8'))
  if (!Array.isArray(parsed))
    throw new TypeError('[cloudflare-kv-wrangler] Wrangler returned an invalid key list.')

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || !('name' in entry) || typeof entry.name !== 'string')
      throw new TypeError(`[cloudflare-kv-wrangler] Wrangler returned an invalid key at index ${index}.`)
    return entry.name
  })
}

function toRawBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value))
    return value
  if (value instanceof Uint8Array)
    return Buffer.from(value)
  if (value instanceof ArrayBuffer)
    return Buffer.from(value)
  if (typeof value === 'string')
    return Buffer.from(value)
  throw new TypeError('[cloudflare-kv-wrangler] Raw values must be a string, Buffer, Uint8Array, or ArrayBuffer.')
}

async function withTemporaryFile<T>(
  suffix: string,
  value: Uint8Array,
  task: (path: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'nuxt-skew-protection-kv-'))
  const path = join(directory, `value${suffix}`)
  await writeFile(path, value)

  try {
    return await task(path)
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** Build-time Cloudflare KV driver backed by the installed Wrangler CLI. */
export function createCloudflareKVWranglerDriver(run: ExecuteWrangler = executeWrangler) {
  return defineDriver((opts: CloudflareKVWranglerOptions) => {
    const { namespaceId, local = false, base = '' } = opts

    if (!namespaceId)
      throw new Error('[cloudflare-kv-wrangler] namespaceId is required')

    const locationFlag = local ? '--local' : '--remote'
    const namespaceArgs = ['--namespace-id', namespaceId, locationFlag] as const
    const prefixKey = (key: string): string => base ? `${base}${key}` : key
    const unprefixKey = (key: string): string => base && key.startsWith(base) ? key.slice(base.length) : key
    const command = async (args: readonly string[]): Promise<WranglerExecution> => assertSuccess(await run(args), args)

    const listKeys = async (basePrefix?: string): Promise<string[]> => {
      const fullPrefix = base ? (basePrefix ? `${base}${basePrefix}` : base) : basePrefix
      const prefixArgs = fullPrefix ? ['--prefix', fullPrefix] : []
      const result = await command(['kv', 'key', 'list', ...prefixArgs, ...namespaceArgs])
      return parseListedKeys(result.stdout).map(unprefixKey)
    }

    const hasItem = async (key: string): Promise<boolean> => {
      const keys = await listKeys(key)
      return keys.includes(key)
    }

    return {
      name: 'cloudflare-kv-wrangler' as const,
      options: opts,

      hasItem,

      async getItem(key: string) {
        const result = await command(['kv', 'key', 'get', prefixKey(key), ...namespaceArgs, '--text'])
        const value = result.stdout.toString('utf8').trim()
        if (value === 'Value not found')
          return null
        return JSON.parse(value)
      },

      async getItemRaw(key: string) {
        if (!await hasItem(key))
          return null
        const result = await command(['kv', 'key', 'get', prefixKey(key), ...namespaceArgs])
        return result.stdout
      },

      async setItem(key: string, value: unknown) {
        await withTemporaryFile('.json', Buffer.from(JSON.stringify(value)), async (path) => {
          await command(['kv', 'key', 'put', prefixKey(key), '--path', path, ...namespaceArgs])
        })
      },

      async setItemRaw(key: string, value: unknown) {
        await withTemporaryFile('.bin', toRawBuffer(value), async (path) => {
          await command(['kv', 'key', 'put', prefixKey(key), '--path', path, ...namespaceArgs])
        })
      },

      async removeItem(key: string) {
        await command(['kv', 'key', 'delete', prefixKey(key), ...namespaceArgs])
      },

      getKeys: listKeys,

      async clear(basePrefix?: string) {
        const keys = await listKeys(basePrefix)
        for (const key of keys)
          await command(['kv', 'key', 'delete', prefixKey(key), ...namespaceArgs])
      },

      async dispose() {},
    }
  })
}

export const cloudflareKVWranglerDriver = createCloudflareKVWranglerDriver()
