import { execFile } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { fetchCloudflareAsset } from '../../src/runtime/server/utils/cloudflare-asset-fetch'
import {
  createCloudflareAssetProtectionPlugin,
  transformCloudflareModuleAdapter,
} from '../../src/utils/cloudflare-cache-protection'

const cloudflareModuleAdapter = `import "#nitro-internal-pollyfills";
import { isPublicAssetURL } from "#nitro-internal-virtual/public-assets";
import { createHandler } from "./_module-handler.mjs";
export default createHandler({
  fetch(request, env, context, url) {
    if (env.ASSETS && isPublicAssetURL(url.pathname)) {
      return env.ASSETS.fetch(request);
    }
  }
});`

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

    const response = await fetchCloudflareAsset(request, { fetch }, () => 'retry-id')

    expect(response).toBe(asset)
    expect(await response.text()).toBe('chunk')
    expect(fetch).toHaveBeenCalledTimes(2)

    const retryRequest = fetch.mock.calls[1]![0] as Request
    expect(retryRequest.url).toBe(
      'https://example.com/_nuxt/entry.ABC123.js?__nuxt_skew_protection_retry=retry-id',
    )
    expect(retryRequest.headers.get('cache-control')).toBe('no-cache')
    expect(retryRequest.headers.get('pragma')).toBe('no-cache')
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
      () => 'retry-id',
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
      () => 'unused',
    )

    expect(response).toBe(asset)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('patches Nitro build assets at the ASSETS binding boundary', () => {
    const result = transformCloudflareModuleAdapter({
      buildAssetsDir: '/_nuxt/',
      code: cloudflareModuleAdapter,
      id: '/app/node_modules/nitropack/dist/presets/cloudflare/runtime/cloudflare-module.mjs',
      runtimeHelperId: '/module/runtime/cloudflare-asset-fetch.js',
    })

    expect(result._tag).toBe('Transformed')
    if (result._tag !== 'Transformed') {
      return
    }
    expect(result.code).toContain(
      'url.pathname.startsWith("/_nuxt/") ? fetchCloudflareAsset(request, env.ASSETS) : env.ASSETS.fetch(request)',
    )
    expect(result.code).toContain(
      'from "/module/runtime/cloudflare-asset-fetch.js";',
    )
  })

  it('patches the Cloudflare Durable adapter used by stateful Nuxt apps', () => {
    const result = transformCloudflareModuleAdapter({
      buildAssetsDir: '/_nuxt/',
      code: cloudflareModuleAdapter,
      id: '/app/node_modules/nitropack/dist/presets/cloudflare/runtime/cloudflare-durable.mjs',
      runtimeHelperId: '/module/runtime/cloudflare-asset-fetch.js',
    })

    expect(result._tag).toBe('Transformed')
    if (result._tag === 'Transformed') {
      expect(result.code).toContain('fetchCloudflareAsset(request, env.ASSETS)')
    }
  })

  it('returns a tagged incompatibility when Nitro changes its asset branch', () => {
    const incompatibleAdapter = cloudflareModuleAdapter.replace(
      'return env.ASSETS.fetch(request);',
      'return fetch(request);',
    )
    const result = transformCloudflareModuleAdapter({
      buildAssetsDir: '/_nuxt/',
      code: incompatibleAdapter,
      id: '/app/node_modules/nitropack/dist/presets/cloudflare/runtime/cloudflare-module.mjs',
      runtimeHelperId: '/module/runtime/cloudflare-asset-fetch.js',
    })

    expect(result).toEqual({
      _tag: 'IncompatibleCloudflareModuleAdapter',
      reason: 'AssetFetchBranchNotFound',
    })

    const plugin = createCloudflareAssetProtectionPlugin({
      buildAssetsDir: '/_nuxt/',
      runtimeHelperId: '/module/runtime/cloudflare-asset-fetch.js',
    })
    const context = {
      error(message: string): never {
        throw new Error(message)
      },
    }
    expect(() => plugin.transform.call(
      context,
      incompatibleAdapter,
      '/app/node_modules/nitropack/dist/presets/cloudflare/runtime/cloudflare-module.mjs',
    )).toThrow('incompatible with asset 404 protection (AssetFetchBranchNotFound)')
  })

  it('ignores adapters outside Nitro cloudflare-module', () => {
    expect(transformCloudflareModuleAdapter({
      buildAssetsDir: '/_nuxt/',
      code: cloudflareModuleAdapter,
      id: '/app/server/entry.mjs',
      runtimeHelperId: '/module/runtime/cloudflare-asset-fetch.js',
    })).toEqual({
      _tag: 'NotCloudflareModuleAdapter',
    })
  })

  it('flags the legacy getAssetFromKV adapter with an upgrade hint', () => {
    const legacyAdapter = `import "#internal/nitro/virtual/polyfill";
import {
  getAssetFromKV,
  mapRequestToAsset
} from "@cloudflare/kv-asset-handler";
import manifest from "__STATIC_CONTENT_MANIFEST";
export default {
  async fetch(request, env, context) {
    return await getAssetFromKV({ request }, {
      ASSET_NAMESPACE: env.__STATIC_CONTENT,
      ASSET_MANIFEST: JSON.parse(manifest)
    });
  }
};`

    const result = transformCloudflareModuleAdapter({
      buildAssetsDir: '/_nuxt/',
      code: legacyAdapter,
      id: '/app/node_modules/nitropack/dist/runtime/entries/cloudflare-module.mjs',
      runtimeHelperId: '/module/runtime/cloudflare-asset-fetch.js',
    })

    expect(result).toEqual({
      _tag: 'IncompatibleCloudflareModuleAdapter',
      reason: 'LegacyCloudflareAdapter',
    })

    const plugin = createCloudflareAssetProtectionPlugin({
      buildAssetsDir: '/_nuxt/',
      runtimeHelperId: '/module/runtime/cloudflare-asset-fetch.js',
    })
    const context = {
      error(message: string): never {
        throw new Error(message)
      },
    }
    expect(() => plugin.transform.call(
      context,
      legacyAdapter,
      '/app/node_modules/nitropack/dist/runtime/entries/cloudflare-module.mjs',
    )).toThrow('requires nitropack >= 2.10.0')
  })

  it('emits syntactically valid JavaScript when transformed', async () => {
    const result = transformCloudflareModuleAdapter({
      buildAssetsDir: '/_nuxt/',
      code: cloudflareModuleAdapter,
      id: '/app/node_modules/nitropack/dist/presets/cloudflare/runtime/cloudflare-module.mjs',
      runtimeHelperId: '/module/runtime/cloudflare-asset-fetch.js',
    })

    expect(result._tag).toBe('Transformed')
    if (result._tag === 'Transformed') {
      const tmpFile = join(tmpdir(), `skew-transformed-${Date.now()}.mjs`)
      try {
        await writeFile(tmpFile, result.code, 'utf-8')
        await expect(promisify(execFile)('node', ['--check', tmpFile])).resolves.toMatchObject({ stdout: '' })
      }
      finally {
        await rm(tmpFile, { force: true })
      }
    }
  })

  it('fails the build when Nitro bypasses the adapter transform', () => {
    const plugin = createCloudflareAssetProtectionPlugin({
      buildAssetsDir: '/_nuxt/',
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

  it('supports path-routed build asset directories', () => {
    const result = transformCloudflareModuleAdapter({
      buildAssetsDir: '/pro/_nuxt',
      code: cloudflareModuleAdapter,
      id: '/app/node_modules/nitropack/dist/presets/cloudflare/runtime/cloudflare-module.mjs',
      runtimeHelperId: '/module/runtime/cloudflare-asset-fetch.js',
    })

    expect(result._tag).toBe('Transformed')
    if (result._tag === 'Transformed') {
      expect(result.code).toContain('url.pathname.startsWith("/pro/_nuxt/")')
    }
  })
})
