import type { Driver } from 'unstorage'
import type { ModuleOptions } from '../module'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useNuxt } from '@nuxt/kit'
import { cloudflareKVWranglerDriver } from './cloudflare-kv-wrangler-driver'

/**
 * Detect Cloudflare KV namespace from nitro config or wrangler.toml
 */
async function detectCloudflareKVNamespace(): Promise<string | null> {
  const nuxt = useNuxt()

  // Check nitro config first
  const kvNamespaces = nuxt.options.nitro?.cloudflare?.wrangler?.kv_namespaces
  if (kvNamespaces?.length) {
    // Prefer SKEW_PROTECTION binding if it exists
    const skewNamespace = kvNamespaces.find(ns => ns.binding === 'SKEW_PROTECTION')
    if (skewNamespace?.id) {
      return skewNamespace.id
    }
    // Otherwise use the first namespace
    if (kvNamespaces[0]?.id) {
      return kvNamespaces[0].id
    }
  }

  const rootDir = nuxt.options.rootDir || process.cwd()

  // Check multiple possible locations for wrangler.toml
  // Priority: root > app subdirectory
  const possiblePaths = [
    join(rootDir, 'wrangler.toml'),
    join(rootDir, 'app', 'wrangler.toml'),
  ]

  for (const wranglerPath of possiblePaths) {
    if (!existsSync(wranglerPath)) {
      continue
    }

    try {
      const content = readFileSync(wranglerPath, 'utf-8')

      // Look for SKEW_PROTECTION binding first
      const skewMatch = content.match(/\[\[kv_namespaces\]\][^[]*?binding\s*=\s*"SKEW_PROTECTION"[^[]*?id\s*=\s*"([^"]+)"/)
      if (skewMatch?.[1]) {
        return skewMatch[1]
      }

      // Otherwise use first kv_namespace
      const kvNamespaceMatch = content.match(/\[\[kv_namespaces\]\][^[]*?id\s*=\s*"([^"]+)"/)
      if (kvNamespaceMatch?.[1]) {
        return kvNamespaceMatch[1]
      }
    }
    catch {
      // Continue to next path
    }
  }

  return null
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
      return cloudflareKVWranglerDriver({
        namespaceId,
        ...driverOptions,
      })
    }
    case 'vercel-kv': {
      // @ts-expect-error untyped
      return vercelKVCLIDriver(driverOptions)
    }
  }
  // For other drivers (fs, redis, etc.), no build-time equivalent needed
  // need to do an dynamic import for the driver to avoid loading native bindings
  const lazyDriver = await import(`unstorage/drivers/${storage.driver}`)
    .then(m => m.default)
  return lazyDriver(driverOptions)
}
