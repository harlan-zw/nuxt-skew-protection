import type { Nuxt } from '@nuxt/schema'
import { describe, expect, it } from 'vitest'
import skewProtectionModule from '../../src/module'
import { resolveBundleAssets, resolveDefaultUpdateStrategy } from '../../src/provider-defaults'

describe('vercel asset defaults', () => {
  it('disables asset persistence when native Vercel protection is active', () => {
    expect(resolveBundleAssets({}, {
      VERCEL_SKEW_PROTECTION_ENABLED: '1',
      VERCEL_DEPLOYMENT_ID: 'dpl_native',
    })).toEqual({
      _tag: 'vercel-native',
      bundleAssets: false,
    })
  })

  it.each([true, false])('preserves explicit bundleAssets: %s', (bundleAssets) => {
    expect(resolveBundleAssets({ bundleAssets }, {
      VERCEL_SKEW_PROTECTION_ENABLED: '1',
      VERCEL_DEPLOYMENT_ID: 'dpl_native',
    })).toEqual({
      _tag: 'configured',
      bundleAssets,
    })
  })

  it.each([
    [{ VERCEL_SKEW_PROTECTION_ENABLED: '0', VERCEL_DEPLOYMENT_ID: 'dpl_native' }],
    [{ VERCEL_SKEW_PROTECTION_ENABLED: '1' }],
  ])('keeps asset persistence without complete native Vercel protection', (env) => {
    expect(resolveBundleAssets({}, env)).toEqual({
      _tag: 'default',
      bundleAssets: true,
    })
  })

  it('keeps omitted bundleAssets observable until setup', async () => {
    const options = await skewProtectionModule.getOptions?.(undefined, {
      options: {},
    } as Nuxt)

    expect(options?.bundleAssets).toBeUndefined()
  })

  it('preserves explicit inline module configuration', async () => {
    const options = await skewProtectionModule.getOptions?.({ bundleAssets: true }, {
      options: {},
    } as Nuxt)

    expect(options?.bundleAssets).toBe(true)
  })
})

describe('default update strategy', () => {
  it.each([
    ['node-server', 'polling'],
    ['vercel', 'polling'],
    ['cloudflare-durable', 'polling'],
    ['cloudflare-module', 'polling'],
    ['cloudflare-pages', 'polling'],
    [undefined, 'polling'],
  ] as const)('picks a strategy the %s preset supports', (nitroPreset, expected) => {
    expect(resolveDefaultUpdateStrategy({ isStatic: false, nitroPreset })).toBe(expected)
  })

  it('polls for a static build', () => {
    expect(resolveDefaultUpdateStrategy({ isStatic: true, nitroPreset: 'cloudflare-durable' })).toBe('polling')
  })
})
