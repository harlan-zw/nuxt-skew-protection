import type { CookieSerializeOptions } from 'cookie-es'
import type { SkewProtectionEvent } from './getRuntimeConfigSkewProtection'
import { getCookie, setCookie } from '#nuxtseo/h3'
import { getRuntimeConfigSkewProtection } from './getRuntimeConfigSkewProtection'

/**
 * Get the skew protection version cookie name from runtime config
 *
 * @param event - H3 event (optional, for better type safety)
 * @returns The configured cookie name
 */
export function getSkewProtectionCookieName(event?: SkewProtectionEvent): string | undefined {
  const { cookie } = getRuntimeConfigSkewProtection(event)
  return cookie === false ? undefined : cookie.name
}

/**
 * Get the skew protection version cookie value
 *
 * @param event - H3 event
 * @returns The cookie value or undefined if not set
 *
 * @example
 * ```ts
 * export default defineEventHandler((event) => {
 *   const version = getSkewProtectionCookie(event)
 *   console.log('Current deployment version:', version)
 * })
 * ```
 */
export function getSkewProtectionCookie(event: SkewProtectionEvent): string | undefined {
  const cookieName = getSkewProtectionCookieName(event)
  if (!cookieName)
    return undefined
  return getCookie(event as Parameters<typeof getCookie>[0], cookieName)
}

/**
 * Set the skew protection version cookie
 *
 * @param event - H3 event
 * @param value - The deployment version to set
 *
 * @example
 * ```ts
 * export default defineEventHandler((event) => {
 *   setSkewProtectionCookie(event, 'deployment-123')
 * })
 * ```
 */
export function setSkewProtectionCookie(event: SkewProtectionEvent, value: string): void {
  const { cookie: cookieConfig } = getRuntimeConfigSkewProtection(event)
  if (cookieConfig === false)
    return
  const { name: cookieName, ...cookieOptions } = cookieConfig
  setCookie(event as Parameters<typeof setCookie>[0], cookieName, value, cookieOptions as CookieSerializeOptions)
}
