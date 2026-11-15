import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadNuxt } from 'nuxt'
import { describe, expect, it } from 'vitest'
import { resolveBuildTimeDriver } from '../../src/unstorage/utils'

const binding = 'SKEW_PROTECTION'
const namespaces = (id: string) => [{ binding, id }]
const config = <T>(kv_namespaces: T) => ({ cloudflare: { wrangler: { kv_namespaces } } })

describe('build-time KV namespace discovery', () => {
  it.each([
    { name: 'resolved Nitro options', resolved: namespaces('resolved-id'), expected: 'resolved-id' },
    { name: 'resolved options before Nuxt options', resolved: namespaces('resolved-id'), nuxt: namespaces('nuxt-id'), expected: 'resolved-id' },
    { name: 'explicit namespace before resolved options', resolved: namespaces('resolved-id'), explicit: 'explicit-id', expected: 'explicit-id' },
    { name: 'Nuxt options when resolved options are empty', resolved: [], nuxt: namespaces('nuxt-id'), expected: 'nuxt-id' },
    { name: 'Nuxt options without resolved options', nuxt: namespaces('nuxt-id'), expected: 'nuxt-id' },
    { name: 'Wrangler file when both option sources are empty', resolved: [], expected: 'file-id' },
  ])('uses $name', async ({ resolved, nuxt: nuxtNamespaces, explicit, expected }) => {
    const rootDir = await mkdtemp(join(tmpdir(), 'skew-kv-discovery-'))
    await writeFile(join(rootDir, 'wrangler.json'), JSON.stringify({ kv_namespaces: namespaces('file-id') }))
    const nuxt = await loadNuxt({ cwd: rootDir, ready: false, overrides: { nitro: config(nuxtNamespaces) } })
    try {
      const driver = await nuxt.runWithContext(() => resolveBuildTimeDriver(
        { driver: 'cloudflare-kv-binding', binding, namespaceId: explicit },
        resolved === undefined ? undefined : config(resolved),
      ))
      expect(driver.options?.namespaceId).toBe(expected)
    }
    finally {
      await nuxt.close()
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it.each([
    { value: [{ binding: 'OTHER', id: 'other-id' }], error: /Available bindings: OTHER/ },
    { value: [...namespaces('first-id'), ...namespaces('second-id')], error: /multiple/ },
    { value: [{ binding }], error: /does not have a namespace id/ },
    { value: 'invalid', error: /invalid kv_namespaces/ },
    { value: [{ binding, id: 1 }], error: /invalid binding or id/ },
  ])('rejects invalid resolved bindings: $error', async ({ value, error }) => {
    const rootDir = await mkdtemp(join(tmpdir(), 'skew-kv-discovery-'))
    const nuxt = await loadNuxt({ cwd: rootDir, ready: false, overrides: { nitro: config(namespaces('fallback-id')) } })
    try {
      await expect(nuxt.runWithContext(() => resolveBuildTimeDriver(
        { driver: 'cloudflare-kv-binding', binding },
        config(value),
      ))).rejects.toThrow(error)
    }
    finally {
      await nuxt.close()
      await rm(rootDir, { recursive: true, force: true })
    }
  })
})
