import { describe, expect, it } from 'vitest'
import { resolvePlatform } from '../../src/platform'

describe('platform resolution', () => {
  it.each([
    'aws-lambda',
    'aws-amplify',
    'netlify',
    'vercel',
    'cloudflare-pages',
  ])('defaults serverless preset %s to polling', (preset) => {
    const result = resolvePlatform({
      preset,
      isStatic: false,
      websocket: false,
      env: {},
    })

    expect(result._tag).toBe('resolved')
    if (result._tag === 'resolved')
      expect(result.updateStrategy).toBe('polling')
  })

  it('uses SSE by default on a persistent Node server', () => {
    const result = resolvePlatform({
      preset: 'node-server',
      isStatic: false,
      websocket: false,
      env: {},
    })

    expect(result).toMatchObject({
      _tag: 'resolved',
      platform: 'node',
      mode: 'portable',
      updateStrategy: 'sse',
    })
  })

  it('uses WebSockets for Cloudflare Durable Objects when enabled', () => {
    const result = resolvePlatform({
      preset: 'cloudflare-durable',
      isStatic: false,
      websocket: true,
      env: {},
    })

    expect(result).toMatchObject({
      _tag: 'resolved',
      platform: 'cloudflare',
      mode: 'portable',
      updateStrategy: 'ws',
    })
  })

  it('selects Vercel native mode when skew protection is enabled', () => {
    const result = resolvePlatform({
      preset: 'vercel',
      isStatic: false,
      websocket: false,
      env: {
        VERCEL_SKEW_PROTECTION_ENABLED: '1',
        VERCEL_DEPLOYMENT_ID: 'dpl_123',
      },
    })

    expect(result).toMatchObject({
      _tag: 'resolved',
      platform: 'vercel',
      mode: 'native',
      updateStrategy: false,
      nativeDeploymentId: 'dpl_123',
    })
  })

  it('keeps Vercel portable when native skew protection is unavailable', () => {
    const result = resolvePlatform({
      preset: 'vercel',
      isStatic: false,
      websocket: false,
      env: {},
    })

    expect(result).toMatchObject({
      _tag: 'resolved',
      platform: 'vercel',
      mode: 'portable',
      updateStrategy: 'polling',
    })
  })

  it('selects Netlify native mode without exposing its deploy token', () => {
    const result = resolvePlatform({
      preset: 'netlify',
      isStatic: false,
      websocket: false,
      env: { NETLIFY_SKEW_PROTECTION_TOKEN: 'secret-deploy-token' },
    })

    expect(result).toMatchObject({
      _tag: 'resolved',
      platform: 'netlify',
      mode: 'native',
      updateStrategy: false,
    })
    expect(JSON.stringify(result)).not.toContain('secret-deploy-token')
  })

  it('requires an unpinned discovery URL for Vercel hybrid mode', () => {
    const result = resolvePlatform({
      preset: 'vercel',
      isStatic: false,
      websocket: false,
      env: {
        VERCEL_SKEW_PROTECTION_ENABLED: '1',
        VERCEL_DEPLOYMENT_ID: 'dpl_123',
      },
      mode: { mode: 'hybrid', discoveryURL: '' },
    })

    expect(result).toMatchObject({
      _tag: 'invalid',
      code: 'discovery-url-required',
    })
  })

  it('allows Vercel hybrid mode with an external discovery manifest', () => {
    const result = resolvePlatform({
      preset: 'vercel',
      isStatic: false,
      websocket: false,
      env: {
        VERCEL_SKEW_PROTECTION_ENABLED: '1',
        VERCEL_DEPLOYMENT_ID: 'dpl_123',
      },
      mode: {
        mode: 'hybrid',
        discoveryURL: 'https://updates.example.com/_nuxt/builds/latest.json',
      },
    })

    expect(result).toMatchObject({
      _tag: 'resolved',
      platform: 'vercel',
      mode: 'hybrid',
      updateStrategy: 'polling',
      discoveryURL: 'https://updates.example.com/_nuxt/builds/latest.json',
    })
  })

  it('allows Cloudflare hybrid mode when an outer version router is explicit', () => {
    const result = resolvePlatform({
      preset: 'cloudflare',
      isStatic: false,
      websocket: false,
      env: {},
      mode: {
        mode: 'hybrid',
        discoveryURL: 'https://updates.example.com/_nuxt/builds/latest.json',
      },
    })

    expect(result).toMatchObject({
      _tag: 'resolved',
      platform: 'cloudflare',
      mode: 'hybrid',
      updateStrategy: 'polling',
    })
  })

  it('returns an error value when native mode is unsupported', () => {
    const result = resolvePlatform({
      preset: 'aws-lambda',
      isStatic: false,
      websocket: false,
      env: {},
      mode: 'native',
    })

    expect(result).toMatchObject({
      _tag: 'invalid',
      code: 'native-unavailable',
      platform: 'aws',
    })
  })

  it('falls back from an incompatible server strategy on static output', () => {
    const result = resolvePlatform({
      preset: 'static',
      isStatic: true,
      websocket: false,
      env: {},
      updateStrategy: 'sse',
    })

    expect(result).toMatchObject({
      _tag: 'resolved',
      updateStrategy: 'polling',
      warnings: [expect.stringContaining('requires a persistent server')],
    })
  })

  it('allows Lambda SSE only with response streaming enabled', () => {
    const disabled = resolvePlatform({
      preset: 'aws-lambda',
      isStatic: false,
      websocket: false,
      responseStreaming: false,
      env: {},
      updateStrategy: 'sse',
    })
    const enabled = resolvePlatform({
      preset: 'aws-lambda',
      isStatic: false,
      websocket: false,
      responseStreaming: true,
      env: {},
      updateStrategy: 'sse',
    })

    expect(disabled).toMatchObject({
      _tag: 'resolved',
      updateStrategy: 'polling',
      warnings: [expect.stringContaining('awsLambda.streaming')],
    })
    expect(enabled).toMatchObject({
      _tag: 'resolved',
      updateStrategy: 'sse',
      warnings: [expect.stringContaining('Lambda invocation')],
    })
  })
})
