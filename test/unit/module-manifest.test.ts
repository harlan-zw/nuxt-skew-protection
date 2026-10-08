import { resolve } from 'node:path'
import { loadNuxt } from '@nuxt/kit'
import { describe, expect, it } from 'vitest'
import skewProtection from '../../src/module'

const cwd = resolve(import.meta.dirname, '../fixtures/basic')

describe('deployment manifest requirement', () => {
  it('rejects a disabled app manifest before building assets', async () => {
    const result = await loadNuxt({
      cwd,
      ready: true,
      overrides: {
        modules: [skewProtection],
        experimental: { appManifest: false },
        devtools: { enabled: false },
      },
    }).then(async (nuxt) => {
      await nuxt.close()
      return 'loaded'
    }, (error: Error) => error.message)
    expect(result).toBe('nuxt-skew-protection requires experimental.appManifest. Enable it or disable the module.')
  })

  it('preserves a disabled app manifest when the module is disabled', async () => {
    const nuxt = await loadNuxt({
      cwd,
      ready: true,
      overrides: {
        modules: [skewProtection],
        skewProtection: { enabled: false },
        experimental: { appManifest: false },
        devtools: { enabled: false },
      },
    })
    expect(nuxt.options.experimental.appManifest).toBe(false)
    await nuxt.close()
  })
})
