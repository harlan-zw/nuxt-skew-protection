import type { SkewProtectionRuntimeConfig } from '../../types'
import { useRuntimeConfig } from 'nuxt/app'

/**
 * Get skew protection runtime config with proper types
 */
// eslint-disable-next-line harlanzw/vue-no-faux-composables -- wraps useRuntimeConfig composable
export function useRuntimeConfigSkewProtection(): SkewProtectionRuntimeConfig {
  return useRuntimeConfig().public.skewProtection as SkewProtectionRuntimeConfig
}
