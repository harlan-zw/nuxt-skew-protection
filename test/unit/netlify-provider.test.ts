import { describe, expect, it } from 'vitest'
import {
  createNetlifyNuxtSkewProtectionConfig,
  createNetlifySkewProtectionConfig,
  NETLIFY_SKEW_PROTECTION_CONFIG_PATH,
  NETLIFY_SKEW_PROTECTION_COOKIE_NAME,
  NETLIFY_SKEW_PROTECTION_TOKEN_ENV,
  parseNetlifySkewProtectionConfig,
  serializeNetlifySkewProtectionConfig,
} from '../../src/provider/netlify'

const updatePaths = [
  '/_nuxt/builds/latest.json',
  '/_nuxt/builds/meta/build-2.json',
  '/__skew/sse',
  '/__skew/ws',
]

describe('netlify native skew protection contract', () => {
  it('scopes generated patterns to Nuxt mount paths', () => {
    const result = createNetlifyNuxtSkewProtectionConfig({
      appBaseURL: '/pro/',
      buildAssetsDir: '/_nuxt/',
      skewBasePath: '/pro/__skew',
    })

    expect(result).toMatchObject({
      _tag: 'ok',
      value: {
        patterns: [
          String.raw`^/pro/_nuxt/.*\.(?:css|js|mjs|wasm|woff2?)$`,
          String.raw`^/pro/(?:.*\/)?_payload\.json$`,
          String.raw`^/pro/api/.*`,
        ],
      },
    })
  })
  it('exposes the Netlify framework API contract constants', () => {
    expect(NETLIFY_SKEW_PROTECTION_CONFIG_PATH).toBe('.netlify/v1/skew-protection.json')
    expect(NETLIFY_SKEW_PROTECTION_TOKEN_ENV).toBe('NETLIFY_SKEW_PROTECTION_TOKEN')
    expect(NETLIFY_SKEW_PROTECTION_COOKIE_NAME).toBe('netlify-skew-token')
  })

  it('builds a safe config while leaving update discovery unpinned', () => {
    const result = createNetlifySkewProtectionConfig({
      patterns: [
        String.raw`^/_nuxt/.*\.(?:css|js|mjs|wasm|woff2?)$`,
        String.raw`(?:^|/)_payload\.json$`,
        String.raw`^/api/.*`,
      ],
      sources: [{ type: 'cookie', name: NETLIFY_SKEW_PROTECTION_COOKIE_NAME }],
      unpinnedPaths: updatePaths,
    })

    expect(result).toEqual({
      _tag: 'ok',
      value: {
        patterns: [
          String.raw`^/_nuxt/.*\.(?:css|js|mjs|wasm|woff2?)$`,
          String.raw`(?:^|/)_payload\.json$`,
          String.raw`^/api/.*`,
        ],
        sources: [{ type: 'cookie', name: 'netlify-skew-token' }],
      },
    })
  })

  it('rejects a pattern that pins an update control-plane path', () => {
    const result = createNetlifySkewProtectionConfig({
      patterns: [String.raw`^/.*`],
      sources: [{ type: 'cookie', name: 'netlify-skew-token' }],
      unpinnedPaths: updatePaths,
    })

    expect(result).toEqual({
      _tag: 'error',
      error: {
        _tag: 'control-plane-protected',
        path: '/_nuxt/builds/latest.json',
        pattern: String.raw`^/.*`,
      },
    })
  })

  it('rejects invalid regular expressions before Netlify receives them', () => {
    const result = createNetlifySkewProtectionConfig({
      patterns: ['['],
      sources: [{ type: 'header', name: 'x-skew-token' }],
      unpinnedPaths: updatePaths,
    })

    expect(result).toMatchObject({
      _tag: 'error',
      error: {
        _tag: 'invalid-pattern',
        pattern: '[',
      },
    })
  })

  it('rejects empty builder patterns and sources', () => {
    expect(createNetlifySkewProtectionConfig({
      patterns: [],
      sources: [{ type: 'query', name: 'skew' }],
      unpinnedPaths: updatePaths,
    })).toEqual({
      _tag: 'error',
      error: { _tag: 'patterns-required' },
    })

    expect(createNetlifySkewProtectionConfig({
      patterns: [String.raw`^/api/.*`],
      sources: [],
      unpinnedPaths: updatePaths,
    })).toEqual({
      _tag: 'error',
      error: { _tag: 'sources-required' },
    })
  })

  it('parses the exact current Netlify schema', () => {
    expect(parseNetlifySkewProtectionConfig({
      patterns: ['/api/.*'],
      sources: [
        { type: 'cookie', name: 'netlify-skew-token' },
        { type: 'header', name: 'x-skew-token' },
        { type: 'query', name: 'skew' },
      ],
    })).toEqual({
      _tag: 'ok',
      value: {
        patterns: ['/api/.*'],
        sources: [
          { type: 'cookie', name: 'netlify-skew-token' },
          { type: 'header', name: 'x-skew-token' },
          { type: 'query', name: 'skew' },
        ],
      },
    })

    expect(parseNetlifySkewProtectionConfig({
      patterns: ['/api/.*'],
      sources: [{ type: 'body', name: 'skew' }],
    })).toMatchObject({
      _tag: 'error',
      error: { _tag: 'invalid-config' },
    })
  })

  it('serializes stable framework API JSON', () => {
    const config = {
      patterns: ['/api/.*'],
      sources: [{ type: 'cookie' as const, name: 'netlify-skew-token' }],
    }

    expect(serializeNetlifySkewProtectionConfig(config)).toBe(`${JSON.stringify(config, null, 2)}\n`)
  })
})
