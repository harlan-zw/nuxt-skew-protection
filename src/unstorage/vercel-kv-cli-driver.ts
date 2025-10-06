import { x } from 'tinyexec'
import { defineDriver } from 'unstorage'

export interface VercelKVCLIOptions {
  /**
   * Vercel KV store name or ID
   */
  storeName: string
  /**
   * Optional team/org scope
   */
  teamId?: string
}

/**
 * Vercel KV driver that uses vercel CLI commands for build-time storage.
 * This leverages existing vercel CLI authentication (no API token needed).
 *
 * Requires: vercel CLI to be installed and authenticated
 */
export const vercelKVCLIDriver = defineDriver((opts: VercelKVCLIOptions) => {
  const { storeName, teamId } = opts

  if (!storeName) {
    throw new Error('[vercel-kv-cli] storeName is required')
  }

  function buildCommand(subcommand: string): string {
    const teamFlag = teamId ? `--team ${teamId}` : ''
    return `vercel kv ${subcommand} ${storeName} ${teamFlag}`.trim()
  }

  async function execVercelKV(subcommand: string): Promise<string> {
    const command = buildCommand(subcommand)
    const result = await x('sh', ['-c', command], {
      throwOnError: true,
    })
    return result.stdout.trim()
  }

  const driver = {
    name: 'vercel-kv-cli' as const,
    options: opts,

    async hasItem(key: string) {
      const result = await execVercelKV(`get "${key}"`)
      return !!result
    },

    async getItem(key: string) {
      const result = await execVercelKV(`get "${key}"`)
      // Try to parse as JSON, fallback to string
      return JSON.parse(result)
    },

    async getItemRaw(key: string) {
      const result = await execVercelKV(`get "${key}"`)
      return Buffer.from(result, 'utf-8')
    },

    async setItem(key: string, value: any) {
      const jsonValue = JSON.stringify(value)
      // Escape quotes for shell
      const escapedValue = jsonValue.replace(/"/g, '\\"')
      await execVercelKV(`set "${key}" "${escapedValue}"`)
    },

    async setItemRaw(key: string, value: any) {
      // For binary data, encode as base64 and store
      const base64Value = Buffer.from(value).toString('base64')
      const escapedValue = base64Value.replace(/"/g, '\\"')
      await execVercelKV(`set "${key}" "${escapedValue}"`)
    },

    async removeItem(key: string) {
      await execVercelKV(`del "${key}"`)
    },

    async getKeys(base?: string) {
      const pattern = base ? `"${base}*"` : '"*"'
      const result = await execVercelKV(`keys ${pattern}`)

      // Parse the output - vercel kv keys returns JSON array
      const keys = JSON.parse(result)
      return Array.isArray(keys) ? keys : []
    },

    async clear(base?: string) {
      const keys = await driver.getKeys(base)
      for (const key of keys) {
        await driver.removeItem(key)
      }
    },

    async dispose() {
      // No cleanup needed for CLI driver
    },
  }

  return driver
})
