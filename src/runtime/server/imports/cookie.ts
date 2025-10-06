import type { CookieSerializeOptions } from 'cookie-es'
import type { H3Event } from 'h3'
import { getCookie, setCookie } from 'h3'
import { getRuntimeConfigSkewProtection } from './getRuntimeConfigSkewProtection'

/**
 * Get the skew protection version cookie name from runtime config
 *
 * @param event - H3 event (optional, for better type safety)
 * @returns The configured cookie name
 */
export function getSkewProtectionCookieName(event?: H3Event): string {
  const { cookie } = getRuntimeConfigSkewProtection(event)
  return cookie.name
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
export function getSkewProtectionCookie(event: H3Event): string | undefined {
  const cookieName = getSkewProtectionCookieName(event)
  return getCookie(event, cookieName)
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
export function setSkewProtectionCookie(event: H3Event, value: string): void {
  const { cookie: cookieConfig } = getRuntimeConfigSkewProtection(event)
  const { name: cookieName, ...cookieOptions } = cookieConfig
  setCookie(event, cookieName, value, cookieOptions as CookieSerializeOptions)
}
