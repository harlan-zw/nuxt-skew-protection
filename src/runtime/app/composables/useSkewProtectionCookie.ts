import type { CookieRef } from '#app'
import { useCookie, useRuntimeConfig } from '#app'
import { COOKIE_CONFIG } from '../../shared/cookie'

/**
 * Composable for managing the skew protection version cookie
 * Provides a unified way to access and set the deployment version cookie
 *
 * @param defaultValue - Optional default value for the cookie
 * @returns A reactive cookie reference
 *
 * @example
 * ```ts
 * const versionCookie = useSkewProtectionCookie()
 * versionCookie.value = 'new-deployment-id'
 * ```
 */
export function useSkewProtectionCookie(defaultValue?: string): CookieRef<string | null | undefined> {
  const config = useRuntimeConfig()
  const cookieName = config.public.skewProtection?.cookieName || '__nkpv'

  return useCookie(cookieName, {
    default: defaultValue ? () => defaultValue : undefined,
    ...COOKIE_CONFIG,
  })
}
