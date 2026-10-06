import type { RequestEvent } from 'nuxt/server'
import type { SkewProtectionRuntimeConfig } from '../../types'
import { useRuntimeConfig } from 'nuxt/server'

/** Event surface shared by Nitro 2 and Nitro 3 request handlers. */
export type SkewProtectionEvent = Pick<RequestEvent, 'req' | 'res' | 'context'>

/**
 * Get skew protection runtime config with proper types
 * Ensures cookie config is always defined with required properties
 */
export function getRuntimeConfigSkewProtection(_event?: SkewProtectionEvent): SkewProtectionRuntimeConfig {
  const config = useRuntimeConfig()
  return config.public.skewProtection as any as SkewProtectionRuntimeConfig
}
