import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { x } from 'tinyexec'
import { defineDriver } from 'unstorage'

export interface AWSS3CLIOptions {
  /**
   * S3 bucket name
   */
  bucket: string
  /**
   * Optional prefix for all keys (like a folder path)
   */
  prefix?: string
  /**
   * AWS region (defaults to CLI configured region)
   */
  region?: string
  /**
   * AWS profile to use (defaults to default profile)
   */
  profile?: string
}

/**
 * AWS S3 driver that uses aws CLI commands for build-time storage.
 * This leverages existing AWS CLI authentication (no API credentials needed).
 *
 * Requires: aws CLI to be installed and configured
 */
export const awsS3CLIDriver = defineDriver((opts: AWSS3CLIOptions) => {
  const { bucket, prefix = '', region, profile } = opts

  if (!bucket) {
    throw new Error('[aws-s3-cli] bucket is required')
  }

  function buildCommand(subcommand: string): string {
    const regionFlag = region ? `--region ${region}` : ''
    const profileFlag = profile ? `--profile ${profile}` : ''
    return `aws s3api ${subcommand} ${regionFlag} ${profileFlag}`.trim()
  }

  function getKey(key: string): string {
    return prefix ? `${prefix}${key}` : key
  }

  async function execAWS(subcommand: string): Promise<string> {
    const command = buildCommand(subcommand)
    const result = await x('sh', ['-c', command], {
      throwOnError: true,
    })
    return result.stdout.trim()
  }

  const driver = {
    name: 'aws-s3-cli' as const,
    options: opts,

    async hasItem(key: string) {
      await execAWS(`head-object --bucket "${bucket}" --key "${getKey(key)}"`)
      return true
    },

    async getItem(key: string) {
      const tmpFile = join(tmpdir(), `s3-get-${Date.now()}.json`)

      await execAWS(`get-object --bucket "${bucket}" --key "${getKey(key)}" "${tmpFile}"`)
      const content = readFileSync(tmpFile, 'utf-8')

      // Try to parse as JSON, fallback to string
      const result = JSON.parse(content)
      unlinkSync(tmpFile)
      return result
    },

    async getItemRaw(key: string) {
      const tmpFile = join(tmpdir(), `s3-get-${Date.now()}.bin`)

      await execAWS(`get-object --bucket "${bucket}" --key "${getKey(key)}" "${tmpFile}"`)
      const result = readFileSync(tmpFile)
      unlinkSync(tmpFile)
      return result
    },

    async setItem(key: string, value: any) {
      const tmpFile = join(tmpdir(), `s3-put-${Date.now()}.json`)
      writeFileSync(tmpFile, JSON.stringify(value))

      await execAWS(`put-object --bucket "${bucket}" --key "${getKey(key)}" --body "${tmpFile}"`)
      unlinkSync(tmpFile)
    },

    async setItemRaw(key: string, value: any) {
      const tmpFile = join(tmpdir(), `s3-put-${Date.now()}.bin`)
      writeFileSync(tmpFile, value)

      await execAWS(`put-object --bucket "${bucket}" --key "${getKey(key)}" --body "${tmpFile}"`)
      unlinkSync(tmpFile)
    },

    async removeItem(key: string) {
      await execAWS(`delete-object --bucket "${bucket}" --key "${getKey(key)}"`)
    },

    async getKeys(base?: string) {
      const searchPrefix = base ? getKey(base) : prefix
      const prefixFlag = searchPrefix ? `--prefix "${searchPrefix}"` : ''
      const result = await execAWS(`list-objects-v2 --bucket "${bucket}" ${prefixFlag}`)

      const data = JSON.parse(result)
      if (!data.Contents || !Array.isArray(data.Contents)) {
        return []
      }

      // Remove the prefix from keys to match expected behavior
      return data.Contents.map((item: any) => {
        let key = item.Key
        if (prefix && key.startsWith(prefix)) {
          key = key.slice(prefix.length)
        }
        return key
      })
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
