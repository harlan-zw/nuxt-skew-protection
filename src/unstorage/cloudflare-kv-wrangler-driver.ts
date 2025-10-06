import { unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { x } from 'tinyexec'
import { defineDriver } from 'unstorage'

export interface CloudflareKVWranglerOptions {
  namespaceId: string
  /** Use local KV storage instead of remote (for wrangler dev) */
  local?: boolean
}

/**
 * Cloudflare KV driver that uses wrangler CLI commands for build-time storage.
 * This leverages existing wrangler authentication (no API token needed).
 *
 * Requires: wrangler CLI to be installed and authenticated
 */
export const cloudflareKVWranglerDriver = defineDriver((opts: CloudflareKVWranglerOptions) => {
  const { namespaceId, local = false } = opts

  if (!namespaceId) {
    throw new Error('[cloudflare-kv-wrangler] namespaceId is required')
  }

  const locationFlag = local ? '--local' : '--remote'

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
      const result = await execWrangler(`wrangler kv key get "${key}" --namespace-id="${namespaceId}" ${locationFlag}`, false)
      return result.exitCode === 0
    },

    async getItem(key: string) {
      const result = await execWrangler(`wrangler kv key get "${key}" --namespace-id="${namespaceId}" ${locationFlag}`, false)
      if (result.exitCode !== 0) {
        return null
      }
      // Try to parse as JSON, fallback to string
      return JSON.parse(result.stdout)
    },

    async getItemRaw(key: string) {
      const result = await execWrangler(`wrangler kv key get "${key}" --namespace-id="${namespaceId}" ${locationFlag}`)
      return Buffer.from(result.stdout, 'utf-8')
    },

    async setItem(key: string, value: any) {
      // Use temp file approach to avoid shell escaping issues with complex JSON
      const tmpFile = join(tmpdir(), `kv-${Date.now()}-${Math.random().toString(36).substring(7)}.json`)
      writeFileSync(tmpFile, JSON.stringify(value))

      try {
        await execWrangler(`wrangler kv key put "${key}" --path="${tmpFile}" --namespace-id="${namespaceId}" ${locationFlag}`)
      }
      finally {
        unlinkSync(tmpFile)
      }
    },

    async setItemRaw(key: string, value: any) {
      // For binary data, write to temp file and use wrangler path option
      const tmpFile = join(tmpdir(), `kv-${Date.now()}.bin`)
      writeFileSync(tmpFile, value)

      await execWrangler(`wrangler kv key put "${key}" --path="${tmpFile}" --namespace-id="${namespaceId}" ${locationFlag}`)
      unlinkSync(tmpFile)
    },

    async removeItem(key: string) {
      await execWrangler(`wrangler kv key delete "${key}" --namespace-id="${namespaceId}" ${locationFlag}`)
    },

    async getKeys(base?: string) {
      const prefix = base ? `--prefix="${base}"` : ''
      const result = await execWrangler(`wrangler kv key list ${prefix} --namespace-id="${namespaceId}" ${locationFlag}`)
      const keys = JSON.parse(result.stdout)
      return keys.map((k: any) => k.name)
    },

    async clear(base?: string) {
      const keys = await driver.getKeys(base)
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
