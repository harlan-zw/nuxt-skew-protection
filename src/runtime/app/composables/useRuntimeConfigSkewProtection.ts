import type { SkewProtectionRuntimeConfig } from '../../types'
import { useRuntimeConfig } from 'nuxt/app'

/**
 * Get skew protection runtime config with proper types
 */
export function useRuntimeConfigSkewProtection(): SkewProtectionRuntimeConfig {
  return useRuntimeConfig().public.skewProtection as SkewProtectionRuntimeConfig
}
