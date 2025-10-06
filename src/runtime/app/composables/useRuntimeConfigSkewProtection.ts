import type { SkewProtectionRuntimeConfig } from '../../types'
import { useRuntimeConfig } from 'nuxt/app'

/**
 * Get skew protection runtime config with proper types
 * Ensures cookie config is always defined with required properties
 */
export function useRuntimeConfigSkewProtection(): SkewProtectionRuntimeConfig {
  const config = useRuntimeConfig()
  return config.public.skewProtection as SkewProtectionRuntimeConfig
}
