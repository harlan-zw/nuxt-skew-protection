import type { ConsolaInstance } from 'consola'
import { useRuntimeConfig } from 'nuxt/app'
import { createModuleLogger } from 'nuxtseo-shared/utils'

export const logger: ConsolaInstance = createModuleLogger('nuxt-skew-protection')

/**
 * Initialize logger with runtime config
 */
export function init() {
  const config = useRuntimeConfig()
  logger.level = config.public.skewProtection.debug ? 4 : 3
}
