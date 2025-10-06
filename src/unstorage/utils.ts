import type { Driver } from 'unstorage'
import type { ModuleOptions } from '../module'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useNuxt } from '@nuxt/kit'
import { awsS3CLIDriver } from './aws-s3-cli-driver'
import { cloudflareKVWranglerDriver } from './cloudflare-kv-wrangler-driver'
import { netlifyBlobsCLIDriver } from './netlify-blobs-cli-driver'
import { vercelKVCLIDriver } from './vercel-kv-cli-driver'

/**
 * Detect Cloudflare KV namespace from wrangler.toml
 */
async function detectCloudflareKVNamespace(): Promise<string | null> {
  const nuxt = useNuxt()
  const rootDir = nuxt.options.rootDir || process.cwd()
  const wranglerPath = join(rootDir, 'wrangler.toml')
  if (!existsSync(wranglerPath)) {
    return null
  }

  try {
    const content = readFileSync(wranglerPath, 'utf-8')

    // Look for kv_namespaces section
    // [[kv_namespaces]]
    // binding = "SKEW_STORAGE" or similar
    // id = "namespace-id"
    const kvNamespaceMatch = content.match(/\[\[kv_namespaces\]\][^[]*?id\s*=\s*"([^"]+)"/)
    if (kvNamespaceMatch?.[1]) {
      return kvNamespaceMatch[1]
    }

    return null
  }
  catch {
    return null
  }
}

/**
 * Resolves build-time equivalent driver for storage configurations that use native bindings.
 * Returns null if the driver doesn't need a build-time equivalent (e.g., fs driver).
 *
 * This function maps runtime storage drivers (which use native platform bindings)
 * to their CLI-based equivalents for build-time operations.
 */
export async function resolveBuildTimeDriver(
  storage: Required<ModuleOptions>['storage'],
): Promise<Driver> {
  const { driver, ...driverOptions } = storage
  switch (driver) {
    case 'cloudflare-kv-binding': {
      let namespaceId = storage.namespaceId
      // Auto-detect namespace from wrangler.toml if not provided
      if (!namespaceId) {
        namespaceId = await detectCloudflareKVNamespace()
      }
      // @ts-expect-error untyped
      return cloudflareKVWranglerDriver(driverOptions)
    }
    case 'vercel-kv': {
      // @ts-expect-error untyped
      return vercelKVCLIDriver(driverOptions)
    }
    case 's3':
    case 'aws-s3': {
      // @ts-expect-error untyped
      return awsS3CLIDriver(driverOptions)
    }

    case 'netlify-blobs': {
      return netlifyBlobsCLIDriver(driverOptions)
    }
  }
  // For other drivers (fs, redis, etc.), no build-time equivalent needed
  // need to do an dynamic import for the driver to avoid loading native bindings
  const lazyDriver = await import(`unstorage/drivers/${storage.driver}`)
    .then(m => m.default)
  return lazyDriver(driverOptions)
}
