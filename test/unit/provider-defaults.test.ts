import type { Nuxt } from '@nuxt/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import skewProtectionModule from '../../src/module'
import { resolveBuildMetadataTracking, resolveBundleAssets, resolveVercelMiddleware } from '../../src/provider-defaults'

describe('provider defaults', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('disables asset bundling when Vercel Skew Protection is enabled', () => {
    expect(resolveBundleAssets({}, true, {
      VERCEL_SKEW_PROTECTION_ENABLED: '1',
      VERCEL_DEPLOYMENT_ID: 'dpl_native',
    })).toEqual({
      _tag: 'provider-default',
      provider: 'vercel',
      bundleAssets: false,
    })
  })

  it.each([true, false])('preserves explicit bundleAssets: %s', (bundleAssets) => {
    expect(resolveBundleAssets({ bundleAssets }, true, {
      VERCEL_SKEW_PROTECTION_ENABLED: '1',
      VERCEL_DEPLOYMENT_ID: 'dpl_native',
    })).toEqual({
      _tag: 'configured',
      bundleAssets,
    })
  })

  it('preserves the deprecated explicit asset handling option', () => {
    expect(resolveBundleAssets({ bundlePreviousDeploymentChunks: true }, true, {
      VERCEL_SKEW_PROTECTION_ENABLED: '1',
      VERCEL_DEPLOYMENT_ID: 'dpl_native',
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

  it('keeps asset bundling when the Vercel deployment ID is unavailable', () => {
    expect(resolveBundleAssets({}, true, {
      VERCEL_SKEW_PROTECTION_ENABLED: '1',
    })).toEqual({
      _tag: 'module-default',
      bundleAssets: true,
    })
  })

  it('lets supported Nitro own the Vercel deployment pin', () => {
    expect(resolveVercelMiddleware({
      nitroSkewProtection: true,
      nitroVersion: '2.13.0',
      deploymentId: 'dpl_native',
    })).toEqual({ _tag: 'nitro-native' })
  })

  it('keeps compatibility middleware for Nitro without native support', () => {
    expect(resolveVercelMiddleware({
      nitroSkewProtection: true,
      nitroVersion: '2.12.9',
      deploymentId: 'dpl_native',
    })).toEqual({ _tag: 'module-compatibility', reason: 'unsupported-nitro' })
  })

  it('keeps compatibility middleware without a deployment ID', () => {
    expect(resolveVercelMiddleware({
      nitroSkewProtection: true,
      nitroVersion: '2.13.0',
    })).toEqual({ _tag: 'module-compatibility', reason: 'missing-deployment-id' })
  })

  it('tracks metadata only for provider-managed asset opt out', () => {
    const providerDefault = resolveBundleAssets({}, true, {
      VERCEL_SKEW_PROTECTION_ENABLED: '1',
      VERCEL_DEPLOYMENT_ID: 'dpl_native',
    })
    const configuredFalse = resolveBundleAssets({ bundleAssets: false }, true, {
      VERCEL_SKEW_PROTECTION_ENABLED: '1',
      VERCEL_DEPLOYMENT_ID: 'dpl_native',
    })

    expect(resolveBuildMetadataTracking(providerDefault)).toBe(true)
    expect(resolveBuildMetadataTracking(configuredFalse)).toBe(false)
    expect(resolveBuildMetadataTracking(providerDefault, false)).toBe(false)
    expect(resolveBuildMetadataTracking(configuredFalse, true)).toBe(true)
  })

  it('defers provider defaults until setup so their source remains observable', async () => {
    vi.stubEnv('VERCEL_SKEW_PROTECTION_ENABLED', '1')
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_native')

    const options = await skewProtectionModule.getOptions?.(undefined, {
      options: {},
    } as Nuxt)

    expect(options?.bundleAssets).toBeUndefined()
  })

  it('gives inline module configuration precedence over the Vercel default', async () => {
    vi.stubEnv('VERCEL_SKEW_PROTECTION_ENABLED', '1')
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_native')

    const options = await skewProtectionModule.getOptions?.({ bundleAssets: true }, {
      options: {},
    } as Nuxt)

    expect(options?.bundleAssets).toBe(true)
  })
})
