import { useRuntimeConfig } from '#imports'
import defu from 'defu'

/**
 * Shared cookie configuration and utilities for skew protection
 */

/**
 * Get the cookie configuration from runtime config
 */
export function getCookieConfig() {
  const config = useRuntimeConfig()
  return defu(config.public.skewProtection?.cookie, {
    path: '/',
    sameSite: 'strict' as const,
    maxAge: 60 * 60 * 24 * 60, // 60 days
  })
}
