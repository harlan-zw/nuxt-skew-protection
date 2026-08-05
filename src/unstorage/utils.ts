import type { Driver } from 'unstorage'
import type { ModuleOptions } from '../module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { useNuxt } from '@nuxt/kit'
import { cloudflareKVWranglerDriver } from './cloudflare-kv-wrangler-driver'

export interface WranglerKVNamespace {
  binding: string
  id: string
}

function parseWranglerKVNamespaces(value: unknown, source: string): WranglerKVNamespace[] {
  if (value === undefined)
    return []
  if (!Array.isArray(value))
    throw new TypeError(`[nuxt-skew-protection] ${source} has an invalid kv_namespaces value.`)

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object')
      throw new TypeError(`[nuxt-skew-protection] ${source} has an invalid kv_namespaces entry at index ${index}.`)

    const binding = 'binding' in entry ? entry.binding : undefined
    const id = 'id' in entry ? entry.id : undefined
    if (typeof binding !== 'string' || typeof id !== 'string')
      throw new TypeError(`[nuxt-skew-protection] ${source} requires string binding and id values for kv_namespaces entry ${index}.`)

    return { binding, id }
  })
}

export function selectCloudflareKVNamespace(
  namespaces: readonly WranglerKVNamespace[],
  binding: string,
): string | null {
  if (namespaces.length === 0)
    return null

  const matches = namespaces.filter(namespace => namespace.binding === binding)
  if (matches.length === 0) {
    const available = namespaces.map(namespace => namespace.binding).join(', ')
    throw new Error(`[nuxt-skew-protection] Cloudflare KV binding ${binding} was not found. Available bindings: ${available}.`)
  }
  if (matches.length > 1)
    throw new Error(`[nuxt-skew-protection] Found multiple Cloudflare KV bindings named ${binding}.`)

  const match = matches[0]
  if (!match)
    throw new Error(`[nuxt-skew-protection] Unable to select Cloudflare KV binding ${binding}.`)
  return match.id
}

export async function readWranglerKVNamespaces(path: string): Promise<WranglerKVNamespace[]> {
  // Wrangler is platform-specific and intentionally loaded only for Cloudflare KV builds.
  const wranglerModule = 'wrangler'
  const { unstable_readConfig } = await import(wranglerModule)
  const config = unstable_readConfig({ config: path }, { hideWarnings: true })
  return parseWranglerKVNamespaces(config.kv_namespaces, path)
}

/** Detect a named Cloudflare KV binding from Nitro or Wrangler configuration. */
async function detectCloudflareKVNamespace(binding: string): Promise<string | null> {
  const nuxt = useNuxt()
  const nitroNamespaces = parseWranglerKVNamespaces(
    nuxt.options.nitro?.cloudflare?.wrangler?.kv_namespaces,
    'nitro.cloudflare.wrangler.kv_namespaces',
  )
  const nitroNamespaceId = selectCloudflareKVNamespace(nitroNamespaces, binding)
  if (nitroNamespaceId)
    return nitroNamespaceId

  const rootDir = nuxt.options.rootDir || process.cwd()
  const configNames = ['wrangler.json', 'wrangler.jsonc', 'wrangler.toml']
  const configDirectories = [rootDir, join(rootDir, 'app')]

  for (const directory of configDirectories) {
    for (const configName of configNames) {
      const path = join(directory, configName)
      if (!existsSync(path))
        continue

      const namespaces = await readWranglerKVNamespaces(path)
      const namespaceId = selectCloudflareKVNamespace(namespaces, binding)
      if (namespaceId)
        return namespaceId
    }
  }

  return null
}

/** Resolve a CLI-capable build-time equivalent for a runtime storage driver. */
export async function resolveBuildTimeDriver(
  storage: Required<ModuleOptions>['storage'],
): Promise<Driver> {
  const {
    driver,
    base,
    binding: configuredBinding,
    namespaceId: configuredNamespaceId,
    ...driverOptions
  } = storage

  if (driver === 'cloudflare-kv-binding') {
    const binding = typeof configuredBinding === 'string' ? configuredBinding : 'SKEW_PROTECTION'
    const namespaceId = typeof configuredNamespaceId === 'string'
      ? configuredNamespaceId
      : await detectCloudflareKVNamespace(binding)

    if (!namespaceId) {
      throw new Error(
        `[nuxt-skew-protection] Unable to resolve Cloudflare KV binding ${binding}. `
        + 'Configure storage.namespaceId or add the binding to wrangler.jsonc.',
      )
    }

    const kvBase = typeof base === 'string' && !base.includes('/')
      ? base
      : 'skew-protection:'

    return cloudflareKVWranglerDriver({
      ...driverOptions,
      namespaceId,
      base: kvBase,
    })
  }

  const lazyDriver = await import(`unstorage/drivers/${driver}`)
    .then(module => module.default)
  return lazyDriver({ base, ...driverOptions })
}
