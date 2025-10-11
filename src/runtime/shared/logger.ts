import { createConsola } from 'consola'
import { useRuntimeConfig } from 'nuxt/app'

export const logger = createConsola({
  defaults: {
    tag: 'nuxt-skew-protection',
  },
})

/**
 * Initialize logger with runtime config
 */
export function init() {
  const config = useRuntimeConfig()
  logger.level = config.public.skewProtection.debug ? 4 : 3
}
