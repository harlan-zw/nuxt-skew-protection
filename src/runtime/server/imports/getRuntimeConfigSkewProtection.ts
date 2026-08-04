import type { SkewProtectionRuntimeConfig } from '../../types'
import { useRuntimeConfig } from '#nuxtseo/nitro'

/** Event surface shared by Nitro 2 and Nitro 3 request handlers. */
export interface SkewProtectionEvent {
  context: object
}

/**
 * Get skew protection runtime config with proper types
 * Ensures cookie config is always defined with required properties
 */
export function getRuntimeConfigSkewProtection(event?: SkewProtectionEvent): SkewProtectionRuntimeConfig {
  const config = useRuntimeConfig(event as Parameters<typeof useRuntimeConfig>[0])
  return config.public.skewProtection as any as SkewProtectionRuntimeConfig
}
