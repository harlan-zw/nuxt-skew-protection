import { defineEventHandler, useRuntimeConfig } from 'nuxt/server'

/**
 * Health check endpoint returning current deployment version.
 * Useful for monitoring and load balancers.
 */
export default defineEventHandler(() => {
  const config = useRuntimeConfig()
  return {
    ok: true,
    version: config.app.buildId,
    uptime: Math.floor(process.uptime()),
  }
})
