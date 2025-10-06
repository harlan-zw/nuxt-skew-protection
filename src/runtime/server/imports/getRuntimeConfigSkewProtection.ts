import type { H3Event } from 'h3'
import type { SkewProtectionRuntimeConfig } from '../../types'
import { useRuntimeConfig } from 'nitropack/runtime'

/**
 * Get skew protection runtime config with proper types
 * Ensures cookie config is always defined with required properties
 */
export function getRuntimeConfigSkewProtection(event?: H3Event): SkewProtectionRuntimeConfig {
  const config = useRuntimeConfig(event)
  return config.public.skewProtection as SkewProtectionRuntimeConfig
}
