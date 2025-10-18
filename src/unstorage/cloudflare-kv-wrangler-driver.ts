import { unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { x } from 'tinyexec'
import { defineDriver } from 'unstorage'

export interface CloudflareKVWranglerOptions {
  namespaceId: string
  /** Use local KV storage instead of remote (for wrangler dev) */
  local?: boolean
  /** Optional prefix for all keys (e.g., 'skew:') */
  base?: string
}

/**
 * Cloudflare KV driver that uses wrangler CLI commands for build-time storage.
 * This leverages existing wrangler authentication (no API token needed).
 *
 * Requires: wrangler CLI to be installed and authenticated
 */
export const cloudflareKVWranglerDriver = defineDriver((opts: CloudflareKVWranglerOptions) => {
  const { namespaceId, local = false, base = '' } = opts

  if (!namespaceId) {
    throw new Error('[cloudflare-kv-wrangler] namespaceId is required')
  }

  const locationFlag = local ? '--local' : '--remote'

  // Helper to add base prefix to keys
  const prefixKey = (key: string): string => base ? `${base}${key}` : key
  // Helper to remove base prefix from keys
  const unprefixKey = (key: string): string => base && key.startsWith(base) ? key.slice(base.length) : key

  async function execWrangler(command: string, throwOnError = true): Promise<{ stdout: string, exitCode: number }> {
    const result = await x('sh', ['-c', `npx ${command}`])

    if (throwOnError && result.exitCode !== 0) {
      throw new Error(
        `[cloudflare-kv-wrangler] Command failed with exit code ${result.exitCode}\n`
        + `Command: ${command}\n`
        + `stdout: ${result.stdout}\n`
        + `stderr: ${result.stderr}`,
      )
    }

    return { stdout: result.stdout.trim(), exitCode: result.exitCode || 0 }
  }

  const driver = {
    name: 'cloudflare-kv-wrangler' as const,
    options: opts,

    async hasItem(key: string) {
      const prefixedKey = prefixKey(key)
      const result = await execWrangler(`wrangler kv key get "${prefixedKey}" --namespace-id="${namespaceId}" ${locationFlag}`, false)
      return result.exitCode === 0
    },

    async getItem(key: string) {
      const prefixedKey = prefixKey(key)
      const result = await execWrangler(`wrangler kv key get "${prefixedKey}" --namespace-id="${namespaceId}" ${locationFlag}`, false)
      if (result.exitCode !== 0) {
        return null
      }
      // Try to parse as JSON, fallback to string
      return JSON.parse(result.stdout)
    },

    async getItemRaw(key: string) {
      const prefixedKey = prefixKey(key)
      const result = await execWrangler(`wrangler kv key get "${prefixedKey}" --namespace-id="${namespaceId}" ${locationFlag}`)
      return Buffer.from(result.stdout, 'utf-8')
    },

    async setItem(key: string, value: any) {
      const prefixedKey = prefixKey(key)
      // Use temp file approach to avoid shell escaping issues with complex JSON
      const tmpFile = join(tmpdir(), `kv-${Date.now()}-${Math.random().toString(36).substring(7)}.json`)
      writeFileSync(tmpFile, JSON.stringify(value))

      try {
        await execWrangler(`wrangler kv key put "${prefixedKey}" --path="${tmpFile}" --namespace-id="${namespaceId}" ${locationFlag}`)
      }
      finally {
        unlinkSync(tmpFile)
      }
    },

    async setItemRaw(key: string, value: any) {
      const prefixedKey = prefixKey(key)
      // For binary data, write to temp file and use wrangler path option
      const tmpFile = join(tmpdir(), `kv-${Date.now()}.bin`)
      writeFileSync(tmpFile, value)

      await execWrangler(`wrangler kv key put "${prefixedKey}" --path="${tmpFile}" --namespace-id="${namespaceId}" ${locationFlag}`)
      unlinkSync(tmpFile)
    },

    async removeItem(key: string) {
      const prefixedKey = prefixKey(key)
      await execWrangler(`wrangler kv key delete "${prefixedKey}" --namespace-id="${namespaceId}" ${locationFlag}`)
    },

    async getKeys(basePrefix?: string) {
      // Combine the driver's base prefix with any additional prefix
      const fullPrefix = base ? (basePrefix ? `${base}${basePrefix}` : base) : basePrefix
      const prefix = fullPrefix ? `--prefix="${fullPrefix}"` : ''
      const result = await execWrangler(`wrangler kv key list ${prefix} --namespace-id="${namespaceId}" ${locationFlag}`)
      const keys = JSON.parse(result.stdout)
      // Remove base prefix from returned keys to maintain consistency
      return keys.map((k: any) => unprefixKey(k.name))
    },

    async clear(basePrefix?: string) {
      const keys = await driver.getKeys(basePrefix)
      for (const key of keys) {
        await driver.removeItem(key)
      }
    },

    async dispose() {
      // No cleanup needed for wrangler CLI driver
    },
  }

  return driver
})
