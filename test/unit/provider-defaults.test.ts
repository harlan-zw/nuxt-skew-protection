import type { Nuxt } from '@nuxt/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import skewProtectionModule from '../../src/module'
import { resolveBundleAssets, resolveVercelMiddleware } from '../../src/provider-defaults'

describe('provider defaults', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('disables asset bundling when Vercel Skew Protection is enabled', () => {
    expect(resolveBundleAssets({}, true, {
      VERCEL_SKEW_PROTECTION_ENABLED: '1',
    })).toEqual({
      _tag: 'provider-default',
      provider: 'vercel',
      bundleAssets: false,
    })
  })

  it.each([true, false])('preserves explicit bundleAssets: %s', (bundleAssets) => {
    expect(resolveBundleAssets({ bundleAssets }, true, {
      VERCEL_SKEW_PROTECTION_ENABLED: '1',
    })).toEqual({
      _tag: 'configured',
      bundleAssets,
    })
  })

  it('preserves the deprecated explicit asset handling option', () => {
    expect(resolveBundleAssets({ bundlePreviousDeploymentChunks: true }, true, {
      VERCEL_SKEW_PROTECTION_ENABLED: '1',
    })).toEqual({
      _tag: 'configured',
      bundleAssets: true,
    })
  })

  it('uses the module default without native provider protection', () => {
    expect(resolveBundleAssets({}, true, {
      VERCEL_SKEW_PROTECTION_ENABLED: '0',
    })).toEqual({
      _tag: 'module-default',
      bundleAssets: true,
    })
  })

  it('lets Nitro own the Vercel deployment pin when native support is enabled', () => {
    expect(resolveVercelMiddleware(undefined, {
      VERCEL_SKEW_PROTECTION_ENABLED: '1',
    })).toEqual({ _tag: 'nitro-native' })
  })

  it('keeps the compatibility middleware when Nitro native support is disabled', () => {
    expect(resolveVercelMiddleware(false, {
      VERCEL_SKEW_PROTECTION_ENABLED: '1',
    })).toEqual({ _tag: 'module-compatibility' })
  })

  it('applies the Vercel default through Nuxt module option resolution', async () => {
    vi.stubEnv('VERCEL_SKEW_PROTECTION_ENABLED', '1')

    const options = await skewProtectionModule.getOptions?.(undefined, {
      options: {},
    } as Nuxt)

    expect(options?.bundleAssets).toBe(false)
  })

  it('gives inline module configuration precedence over the Vercel default', async () => {
    vi.stubEnv('VERCEL_SKEW_PROTECTION_ENABLED', '1')

    const options = await skewProtectionModule.getOptions?.({ bundleAssets: true }, {
      options: {},
    } as Nuxt)

    expect(options?.bundleAssets).toBe(true)
  })
})
