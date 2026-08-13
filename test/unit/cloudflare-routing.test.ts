import { describe, expect, it } from 'vitest'
import { withCloudflareBuildAssetRouting } from '../../src/utils/cloudflare-routing'

describe('cloudflare build asset routing', () => {
  it('routes only the Nuxt build asset prefix through the Worker', () => {
    expect(withCloudflareBuildAssetRouting(undefined, '/_nuxt/')).toEqual(['/_nuxt/*'])
    expect(withCloudflareBuildAssetRouting(false, '/pro/_nuxt/')).toEqual(['/pro/_nuxt/*'])
  })

  it('preserves global Worker-first routing', () => {
    expect(withCloudflareBuildAssetRouting(true, '/_nuxt/')).toBe(true)
  })

  it('merges with existing selective routes without duplicates', () => {
    expect(withCloudflareBuildAssetRouting(['/api/*'], '/_nuxt/')).toEqual(['/api/*', '/_nuxt/*'])
    expect(withCloudflareBuildAssetRouting(['/api/*', '/_nuxt/*'], '/_nuxt/')).toEqual(['/api/*', '/_nuxt/*'])
  })
})
