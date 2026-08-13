import type { NuxtSkewProtectionPrivateRuntimeConfig } from '../../types'

export function resolveVercelCookiePath(config?: NuxtSkewProtectionPrivateRuntimeConfig): string {
  return config?.vercelCookiePath || '/'
}
