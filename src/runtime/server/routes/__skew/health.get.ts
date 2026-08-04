import { defineEventHandler } from '#nuxtseo/h3'
import { useRuntimeConfig } from '#nuxtseo/nitro'

/**
 * Health check endpoint returning current deployment version.
 * Useful for monitoring and load balancers.
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  return {
    ok: true,
    version: config.app.buildId,
    uptime: Math.floor(process.uptime()),
  }
})
