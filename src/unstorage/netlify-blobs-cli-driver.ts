import { unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { x } from 'tinyexec'
import { defineDriver } from 'unstorage'

export interface NetlifyBlobsCLIOptions {
  /**
   * Netlify site ID or name
   */
  siteId?: string
  /**
   * Blob store name
   * @default 'production'
   */
  storeName?: string
}

/**
 * Netlify Blobs driver that uses netlify CLI commands for build-time storage.
 * This leverages existing Netlify CLI authentication (no API token needed).
 *
 * Requires: netlify CLI to be installed and authenticated
 */
export const netlifyBlobsCLIDriver = defineDriver((opts: NetlifyBlobsCLIOptions) => {
  const { siteId, storeName = 'production' } = opts

  function buildCommand(subcommand: string): string {
    const siteFlag = siteId ? `--site ${siteId}` : ''
    return `netlify blobs:${subcommand} ${siteFlag}`.trim()
  }

  async function execNetlify(subcommand: string): Promise<string> {
    const command = buildCommand(subcommand)
    const result = await x('sh', ['-c', command], {
      throwOnError: true,
    })
    return result.stdout.trim()
  }

  const driver = {
    name: 'netlify-blobs-cli' as const,
    options: opts,

    async hasItem(key: string) {
      await execNetlify(`get "${key}" --store "${storeName}"`)
      return true
    },

    async getItem(key: string) {
      const result = await execNetlify(`get "${key}" --store "${storeName}"`)
      // Try to parse as JSON, fallback to string
      return JSON.parse(result)
    },

    async getItemRaw(key: string) {
      const result = await execNetlify(`get "${key}" --store "${storeName}"`)
      return Buffer.from(result, 'utf-8')
    },

    async setItem(key: string, value: any) {
      const tmpFile = join(tmpdir(), `netlify-blob-${Date.now()}.json`)
      writeFileSync(tmpFile, JSON.stringify(value))

      await execNetlify(`set "${key}" "${tmpFile}" --store "${storeName}"`)
      unlinkSync(tmpFile)
    },

    async setItemRaw(key: string, value: any) {
      const tmpFile = join(tmpdir(), `netlify-blob-${Date.now()}.bin`)
      writeFileSync(tmpFile, value)

      await execNetlify(`set "${key}" "${tmpFile}" --store "${storeName}"`)
      unlinkSync(tmpFile)
    },

    async removeItem(key: string) {
      await execNetlify(`delete "${key}" --store "${storeName}"`)
    },

    async getKeys(base?: string) {
      const prefix = base || ''
      const result = await execNetlify(`list --store "${storeName}" --prefix "${prefix}" --json`)

      // Parse JSON output from netlify blobs:list
      const blobs = JSON.parse(result)
      if (Array.isArray(blobs)) {
        return blobs.map((blob: any) => blob.key || blob)
      }
      return []
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
