import type { H3Event } from 'h3'
import { useRuntimeConfig } from '#imports'
import { getCookie, setCookie } from 'h3'
import { COOKIE_CONFIG } from '../../shared/cookie'

/**
 * Get the skew protection version cookie name from runtime config
 *
 * @param event - H3 event (optional, for better type safety)
 * @returns The configured cookie name
 */
export function getSkewProtectionCookieName(event?: H3Event): string {
  const config = useRuntimeConfig(event)
  return config.public.skewProtection?.cookieName || '__nkpv'
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
  const cookieName = getSkewProtectionCookieName(event)
  setCookie(event, cookieName, value, COOKIE_CONFIG)
}
