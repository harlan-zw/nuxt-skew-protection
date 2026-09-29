import { describe, expect, it } from 'vitest'
import { resolveBasePath, resolveBuildAssetsPath, resolveCookieName, toServerRoute } from '../../src/resolve-base-path'

describe('resolveBasePath', () => {
  it('defaults to /__skew for a standard single-app at the root', () => {
    expect(resolveBasePath()).toBe('/__skew')
    expect(resolveBasePath({ app: { baseURL: '/', buildAssetsDir: '/_nuxt/' } })).toBe('/__skew')
  })

  it('auto-detects the mount point from an absolute buildAssetsDir (the pro case)', () => {
    // apps/pro serves chunks from /pro/_nuxt/ and owns the /pro/* route only.
    expect(resolveBasePath({ app: { baseURL: '/', buildAssetsDir: '/pro/_nuxt/' } })).toBe('/pro/__skew')
  })

  it('ignores nested namespaces inside the Nuxt assets directory', () => {
    expect(resolveBasePath({ app: { baseURL: '/', buildAssetsDir: '/_nuxt/v2/' } })).toBe('/__skew')
    expect(resolveBasePath({ app: { baseURL: '/', buildAssetsDir: '/pro/_nuxt/v2/' } })).toBe('/pro/__skew')
  })

  it('auto-detects from app.baseURL when buildAssetsDir is the default', () => {
    expect(resolveBasePath({ app: { baseURL: '/pro/', buildAssetsDir: '/_nuxt/' } })).toBe('/pro/__skew')
  })

  it('handles a multi-segment mount prefix', () => {
    expect(resolveBasePath({ app: { baseURL: '/', buildAssetsDir: '/app/pro/_nuxt/' } })).toBe('/app/pro/__skew')
  })

  it('uses an explicit basePath verbatim, ignoring auto-detection', () => {
    expect(resolveBasePath({ basePath: '/custom/__skew', app: { buildAssetsDir: '/pro/_nuxt/' } })).toBe('/custom/__skew')
  })

  it('normalizes slashes on an explicit basePath', () => {
    expect(resolveBasePath({ basePath: 'pro/__skew/' })).toBe('/pro/__skew')
    expect(resolveBasePath({ basePath: '//pro//__skew//' })).toBe('/pro//__skew')
  })

  it('falls back to root when no app config is present', () => {
    expect(resolveBasePath({ app: {} })).toBe('/__skew')
  })
})

describe('resolveBuildAssetsPath', () => {
  it('includes the Nuxt app base URL', () => {
    expect(resolveBuildAssetsPath({ baseURL: '/pro/', buildAssetsDir: '/_nuxt/' }))
      .toBe('/pro/_nuxt/')
  })

  it('normalizes a root-mounted asset directory', () => {
    expect(resolveBuildAssetsPath({ baseURL: '/', buildAssetsDir: '/pro/_nuxt/' }))
      .toBe('/pro/_nuxt/')
  })
})

describe('resolveCookieName', () => {
  it('keeps the bare default for a root-mounted app', () => {
    expect(resolveCookieName(undefined, '/__skew')).toBe('__nkpv')
  })

  it('suffixes with the mount point for a path-routed app', () => {
    expect(resolveCookieName(undefined, '/pro/__skew')).toBe('__nkpv_pro')
  })

  it('joins a multi-segment mount with underscores', () => {
    expect(resolveCookieName(undefined, '/app/pro/__skew')).toBe('__nkpv_app_pro')
  })

  it('honours an explicit name over derivation', () => {
    expect(resolveCookieName('__custom', '/pro/__skew')).toBe('__custom')
  })

  it('namespaces a custom basePath that has no skew segment', () => {
    expect(resolveCookieName(undefined, '/foo')).toBe('__nkpv_foo')
  })
})

describe('resolveBasePath under app.baseURL', () => {
  it('keeps an absolute buildAssetsDir mount under app.baseURL', () => {
    expect(resolveBasePath({ app: { baseURL: '/app/', buildAssetsDir: '/pro/_nuxt/' } })).toBe('/app/pro/__skew')
  })

  it('keeps an explicit basePath that is already under app.baseURL', () => {
    expect(resolveBasePath({ basePath: '/app/custom', app: { baseURL: '/app/' } })).toBe('/app/custom')
  })

  it('moves an explicit basePath outside app.baseURL under it', () => {
    expect(resolveBasePath({ basePath: '/__skew', app: { baseURL: '/app/' } })).toBe('/app/__skew')
    expect(resolveBasePath({ basePath: '/application/__skew', app: { baseURL: '/app/' } })).toBe('/app/application/__skew')
  })
})

describe('toServerRoute', () => {
  it('strips app.baseURL because Nitro prefixes handler routes with it', () => {
    expect(toServerRoute('/app/__skew/sse', '/app/')).toBe('/__skew/sse')
    expect(toServerRoute('/app/pro/__skew/health', '/app')).toBe('/pro/__skew/health')
  })

  it('keeps the path for a root app', () => {
    expect(toServerRoute('/pro/__skew/sse', '/')).toBe('/pro/__skew/sse')
    expect(toServerRoute('/__skew/sse', undefined)).toBe('/__skew/sse')
  })
})
