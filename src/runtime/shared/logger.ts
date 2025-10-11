import { createConsola } from 'consola'

export const logger = createConsola({
  defaults: {
    tag: 'nuxt-skew-protection',
  },
})

/**
 * Set logger level based on debug mode from runtime config
 */
export function setLoggerDebugMode(debug: boolean) {
  logger.level = debug ? 4 : 3
}
