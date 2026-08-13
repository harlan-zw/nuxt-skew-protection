import { beforeEach, describe, expect, it, vi } from 'vitest'

let cookieConfig: false | { name: string, path: string } = false

vi.mock('#nuxtseo/h3', () => ({
  getCookie: vi.fn(),
  setCookie: vi.fn(),
}))

vi.mock('../../src/runtime/server/imports/getRuntimeConfigSkewProtection', () => ({
  getRuntimeConfigSkewProtection: vi.fn(() => ({ cookie: cookieConfig })),
}))

describe('server cookie helpers', () => {
  beforeEach(() => {
    cookieConfig = false
    vi.clearAllMocks()
  })

  it('returns no cookie name when cookies are disabled', async () => {
    const { getSkewProtectionCookieName } = await import('../../src/runtime/server/imports/cookie')

    expect(getSkewProtectionCookieName()).toBeUndefined()
  })

  it('does not read a cookie when cookies are disabled', async () => {
    const { getCookie } = await import('#nuxtseo/h3')
    const { getSkewProtectionCookie } = await import('../../src/runtime/server/imports/cookie')

    expect(getSkewProtectionCookie({ context: {} })).toBeUndefined()
    expect(getCookie).not.toHaveBeenCalled()
  })

  it('does not set a cookie when cookies are disabled', async () => {
    const { setCookie } = await import('#nuxtseo/h3')
    const { setSkewProtectionCookie } = await import('../../src/runtime/server/imports/cookie')

    setSkewProtectionCookie({ context: {} }, 'build-id')

    expect(setCookie).not.toHaveBeenCalled()
  })
})
