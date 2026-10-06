import { beforeEach, describe, expect, it, vi } from 'vitest'

let cookieConfig: false | { name: string, path: string } = false

vi.mock('nuxt/server', () => ({
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
    const { getCookie } = await import('nuxt/server')
    const { getSkewProtectionCookie } = await import('../../src/runtime/server/imports/cookie')

    expect(getSkewProtectionCookie({ context: {}, req: new Request('http://localhost'), res: { status: 200, statusText: '', headers: new Headers() } })).toBeUndefined()
    expect(getCookie).not.toHaveBeenCalled()
  })

  it('does not set a cookie when cookies are disabled', async () => {
    const { setCookie } = await import('nuxt/server')
    const { setSkewProtectionCookie } = await import('../../src/runtime/server/imports/cookie')

    setSkewProtectionCookie({ context: {}, req: new Request('http://localhost'), res: { status: 200, statusText: '', headers: new Headers() } }, 'build-id')

    expect(setCookie).not.toHaveBeenCalled()
  })
})
