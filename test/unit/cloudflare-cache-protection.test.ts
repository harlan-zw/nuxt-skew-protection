import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchCloudflareAsset,
  fetchCloudflareBuildAsset,
} from '../../src/runtime/server/utils/cloudflare-asset-fetch'
import {
  createCloudflareAssetProtectionPlugin,
  withoutCloudflareAssetProtectionPlugin,
} from '../../src/utils/cloudflare-cache-protection'

describe('cloudflare asset cache protection', () => {
  it('recovers when Cloudflare initially misses a deployed asset', async () => {
    const missing = new Response('missing', {
      status: 404,
      headers: {
        'cache-control': 'public, max-age=31536000, immutable',
      },
    })
    const asset = new Response('chunk', {
      status: 200,
      headers: {
        'cache-control': 'public, max-age=31536000, immutable',
      },
    })
    const fetch = vi.fn()
      .mockResolvedValueOnce(missing)
      .mockResolvedValueOnce(asset)
    const request = new Request('https://example.com/_nuxt/entry.ABC123.js')

    const response = await fetchCloudflareAsset(request, { fetch })

    expect(response).toBe(asset)
    expect(await response.text()).toBe('chunk')
    expect(fetch).toHaveBeenCalledTimes(2)

    const retryRequest = fetch.mock.calls[1]![0] as Request
    expect(retryRequest.url).toBe(request.url)
    expect(retryRequest.cache).toBe('no-cache')
  })

  it('prevents a repeated asset failure from entering browser or edge caches', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('first miss', {
        status: 404,
        headers: {
          'cache-control': 'public, max-age=31536000, immutable',
        },
      }))
      .mockResolvedValueOnce(new Response('second miss', {
        status: 404,
        headers: {
          'cache-control': 'public, max-age=31536000, immutable',
          'cdn-cache-control': 'public, max-age=31536000, immutable',
          'cloudflare-cdn-cache-control': 'public, max-age=31536000, immutable',
        },
      }))

    const response = await fetchCloudflareAsset(
      new Request('https://example.com/_nuxt/entry.ABC123.js'),
      { fetch },
    )

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('second miss')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('cdn-cache-control')).toBe('no-store')
    expect(response.headers.get('cloudflare-cdn-cache-control')).toBe('no-store')
  })

  it('returns a successful asset without cloning or retrying it', async () => {
    const asset = new Response('chunk')
    const fetch = vi.fn().mockResolvedValue(asset)

    const response = await fetchCloudflareAsset(
      new Request('https://example.com/_nuxt/entry.ABC123.js'),
      { fetch },
    )

    expect(response).toBe(asset)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('prevents the latest build manifest from entering browser or edge caches', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"id":"build-1"}', {
      headers: {
        'cache-control': 'public, max-age=31536000, immutable',
        'cdn-cache-control': 'public, max-age=31536000, immutable',
        'cloudflare-cdn-cache-control': 'public, max-age=31536000, immutable',
      },
    }))

    const response = await fetchCloudflareBuildAsset(
      new Request('https://example.com/pro/_nuxt/builds/latest.json'),
      { fetch },
      '/pro/_nuxt/',
      '/pro/__skew/asset',
    )

    expect(await response?.json()).toEqual({ id: 'build-1' })
    expect(response?.headers.get('cache-control')).toBe('no-store')
    expect(response?.headers.get('cdn-cache-control')).toBe('no-store')
    expect(response?.headers.get('cloudflare-cdn-cache-control')).toBe('no-store')
  })

  it('wraps Nitro entry without depending on its source shape', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'skew-entry-'))
    const nitroEntryPath = join(testDir, 'nitro-entry.mjs')
    const runtimeHelperPath = join(testDir, 'runtime-helper.mjs')
    const plugin = createCloudflareAssetProtectionPlugin({
      buildAssetsPath: '/pro/_nuxt',
      recoveryPath: '/pro/__skew/asset',
      runtimeHelperId: runtimeHelperPath,
    })
    const context = {
      error(message: string): never {
        throw new Error(message)
      },
    }
    const options = plugin.options.call(context, {
      input: nitroEntryPath,
    })
    const virtualId = options.input as string
    const resolvedId = plugin.resolveId(virtualId)
    const code = plugin.load(resolvedId!)

    expect(code).toContain(`import nitroEntry from ${JSON.stringify(nitroEntryPath)}`)
    expect(code).toContain(`export * from ${JSON.stringify(nitroEntryPath)}`)
    expect(code).toContain('...nitroEntry')
    expect(code).toContain('fetchCloudflareBuildAsset(request, env.ASSETS, "/pro/_nuxt/", "/pro/__skew/asset")')
    expect(code).toContain('assetResponse ?? nitroEntry.fetch(request, env, context)')

    try {
      await Promise.all([
        writeFile(nitroEntryPath, `
const handler = Object.fromEntries(
  ['fetch', 'scheduled', 'email', 'queue', 'tail', 'trace'].map(name => [name, () => name]),
)
export class $DurableObject {}
export default handler
`, 'utf-8'),
        writeFile(runtimeHelperPath, 'export const fetchCloudflareBuildAsset = () => undefined\n', 'utf-8'),
        writeFile(join(testDir, 'protected-entry.mjs'), code!, 'utf-8'),
        writeFile(join(testDir, 'verify.mjs'), `
import assert from 'node:assert/strict'
import handler, { $DurableObject } from './protected-entry.mjs'
assert.equal(typeof $DurableObject, 'function')
for (const name of ['scheduled', 'email', 'queue', 'tail', 'trace']) {
  assert.equal(typeof handler[name], 'function')
}
assert.equal(handler.fetch(new Request('https://example.com/'), {}, {}), 'fetch')
`, 'utf-8'),
      ])
      await expect(promisify(execFile)('node', [join(testDir, 'verify.mjs')])).resolves.toMatchObject({ stdout: '' })
    }
    finally {
      await rm(testDir, { force: true, recursive: true })
    }

    expect(() => plugin.buildEnd.call(context)).not.toThrow()
  })

  it('fails the build when Nitro does not use one string entry', () => {
    const plugin = createCloudflareAssetProtectionPlugin({
      buildAssetsPath: '/_nuxt/',
      recoveryPath: '/__skew/asset',
      runtimeHelperId: '/module/runtime/cloudflare-asset-fetch.js',
    })
    const context = {
      error(message: string): never {
        throw new Error(message)
      },
    }

    expect(() => plugin.options.call(context, {
      input: ['/nitro/cloudflare-module.mjs'],
    })).toThrow('requires one Nitro entry')
  })

  it('rejects legacy Cloudflare adapters without an ASSETS binding', () => {
    const plugin = createCloudflareAssetProtectionPlugin({
      buildAssetsPath: '/_nuxt/',
      recoveryPath: '/__skew/asset',
      runtimeHelperId: '/module/runtime/cloudflare-asset-fetch.js',
    })
    const context = {
      error(message: string): never {
        throw new Error(message)
      },
    }

    expect(() => plugin.options.call(context, {
      input: '/app/node_modules/nitropack/dist/runtime/entries/cloudflare-module.mjs',
    })).toThrow('requires nitropack >= 2.10.0')
  })

  it('leaves Nitro prerender builds untouched', () => {
    const plugin = createCloudflareAssetProtectionPlugin({
      buildAssetsPath: '/_nuxt/',
      recoveryPath: '/__skew/asset',
      runtimeHelperId: '/module/runtime/cloudflare-asset-fetch.js',
    })
    const context = {
      error(message: string): never {
        throw new Error(message)
      },
    }
    const input = '/app/node_modules/nitropack/dist/presets/_nitro/runtime/nitro-prerenderer'

    expect(plugin.options.call(context, { input })).toEqual({ input })
    expect(() => plugin.buildEnd.call(context)).not.toThrow()
  })

  it('removes the Worker asset wrapper from Nitro prerender config', () => {
    const protectionPlugin = createCloudflareAssetProtectionPlugin({
      buildAssetsPath: '/_nuxt/',
      recoveryPath: '/__skew/asset',
      runtimeHelperId: '/module/runtime/cloudflare-asset-fetch.js',
    })
    const otherPlugin = { name: 'other' }

    expect(withoutCloudflareAssetProtectionPlugin([
      otherPlugin,
      protectionPlugin,
    ])).toEqual([otherPlugin])
  })

  it('fails the build when the protected entry is not bundled', () => {
    const plugin = createCloudflareAssetProtectionPlugin({
      buildAssetsPath: '/_nuxt/',
      recoveryPath: '/__skew/asset',
      runtimeHelperId: '/module/runtime/cloudflare-asset-fetch.js',
    })
    const context = {
      error(message: string): never {
        throw new Error(message)
      },
    }

    expect(() => plugin.buildEnd.call(context)).toThrow(
      'Refusing to build without asset 404 protection',
    )
  })

  it('fetches build asset requests at the Worker entry', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('missing', { status: 404 }))
      .mockResolvedValueOnce(new Response('chunk'))
    const assetRequest = new Request('https://example.com/pro/_nuxt/entry.js')

    const response = await fetchCloudflareBuildAsset(
      assetRequest,
      { fetch },
      '/pro/_nuxt/',
      '/pro/__skew/asset',
    )

    expect(await response?.text()).toBe('chunk')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps non-build requests untouched', () => {
    expect(fetchCloudflareBuildAsset(
      new Request('https://example.com/favicon.ico'),
      { fetch: vi.fn() },
      '/_nuxt/',
      '/__skew/asset',
    )).toBeUndefined()
  })

  it('recovers a cached browser miss through a dedicated Worker endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('chunk'))
    const recoveryRequest = new Request(
      'https://example.com/pro/__skew/asset?url=https%3A%2F%2Fexample.com%2Fpro%2F_nuxt%2Fentry.js',
    )

    const response = await fetchCloudflareBuildAsset(
      recoveryRequest,
      { fetch },
      '/pro/_nuxt/',
      '/pro/__skew/asset',
    )

    expect(await response?.text()).toBe('chunk')
    const assetRequest = fetch.mock.calls[0]![0] as Request
    expect(assetRequest.url).toBe('https://example.com/pro/_nuxt/entry.js')
    expect(assetRequest.cache).toBe('no-cache')
  })

  it('rejects recovery requests for assets outside the configured origin and prefix', async () => {
    const fetch = vi.fn()

    for (const target of ['https://evil.example/_nuxt/entry.js', 'https://%']) {
      const url = new URL('https://example.com/__skew/asset')
      url.searchParams.set('url', target)
      const response = await fetchCloudflareBuildAsset(
        new Request(url),
        { fetch },
        '/_nuxt/',
        '/__skew/asset',
      )

      expect(response?.status).toBe(400)
      expect(response?.headers.get('cache-control')).toBe('no-store')
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns a non-cacheable miss when the asset binding is unavailable', async () => {
    const response = await fetchCloudflareBuildAsset(
      new Request('https://example.com/_nuxt/entry.js'),
      undefined,
      '/_nuxt/',
      '/__skew/asset',
    )

    expect(response?.status).toBe(404)
    expect(response?.headers.get('cache-control')).toBe('no-store')
    expect(response?.headers.get('cdn-cache-control')).toBe('no-store')
    expect(response?.headers.get('cloudflare-cdn-cache-control')).toBe('no-store')
  })
})
