import { describe, expect, it } from 'vitest'
import { shouldDisableAssetErrorCaching } from '../../src/runtime/server/utils/asset-cache-protection'
import { applyCloudflareCacheProtection } from '../../src/utils/cloudflare-cache-protection'

describe('cloudflare asset cache protection', () => {
  it('keeps successful build assets immutable while allowing misses to fall through', () => {
    const config = {
      publicAssets: [
        {
          dir: '/app/.nuxt/dist/client/_nuxt',
          baseURL: '/_nuxt/',
          maxAge: 31_536_000,
        },
      ],
      routeRules: {},
    }

    const result = applyCloudflareCacheProtection(config, '/_nuxt/')

    expect(result).toEqual({
      _tag: 'Protected',
      route: '/_nuxt/**',
    })
    expect(config.publicAssets[0]?.fallthrough).toBe(true)
    expect(config.routeRules).toEqual({
      '/_nuxt/**': {
        headers: {
          'cache-control': 'public, max-age=31536000, immutable',
        },
      },
    })
  })

  it('preserves an explicit cache policy', () => {
    const config = {
      publicAssets: [
        {
          dir: '/app/.nuxt/dist/client/_nuxt',
          baseURL: '/_nuxt',
          maxAge: 31_536_000,
        },
      ],
      routeRules: {
        '/_nuxt/**': {
          headers: {
            'Cache-Control': 'public, max-age=86400',
          },
        },
      },
    }

    const result = applyCloudflareCacheProtection(config, '/_nuxt/')

    expect(result._tag).toBe('Protected')
    expect(config.routeRules['/_nuxt/**']?.headers).toEqual({
      'Cache-Control': 'public, max-age=86400',
    })
  })

  it('returns a tagged failure when Nitro does not expose the build asset directory', () => {
    const config = {
      publicAssets: [
        {
          dir: '/app/public',
          baseURL: '/',
          maxAge: 0,
        },
      ],
      routeRules: {},
    }

    expect(applyCloudflareCacheProtection(config, '/_nuxt/')).toEqual({
      _tag: 'BuildAssetDirectoryNotFound',
      buildAssetsDir: '/_nuxt/',
    })
  })

  it.each([
    ['/_nuxt/missing.js', 404, '/_nuxt/', true],
    ['/_nuxt/missing.js', 500, '/_nuxt/', true],
    ['/_nuxt/current.js', 200, '/_nuxt/', false],
    ['/api/missing', 404, '/_nuxt/', false],
    ['/pro/_nuxt/missing.js', 404, '/pro/_nuxt/', true],
  ])('decides whether %s with status %s must be no-store', (path, status, buildAssetsDir, expected) => {
    expect(shouldDisableAssetErrorCaching(path, status, buildAssetsDir)).toBe(expected)
  })
})
