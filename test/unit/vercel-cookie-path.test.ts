import { describe, expect, it } from 'vitest'
import { resolveVercelCookiePath } from '../../src/runtime/server/utils/vercel-cookie-path'

describe('resolveVercelCookiePath', () => {
  it('defaults to the root path', () => {
    expect(resolveVercelCookiePath()).toBe('/')
  })

  it('uses the configured app mount path', () => {
    expect(resolveVercelCookiePath({ vercelCookiePath: '/pro/' })).toBe('/pro/')
  })
})
