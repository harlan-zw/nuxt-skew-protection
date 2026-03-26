import { getSiteConfig } from '#site-config/server/composables'
import { defineEventHandler } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

/**
 * Devtools debug endpoint returning module configuration and resolved state.
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  const siteConfig = getSiteConfig(event as any)
  const skewConfig = config.public?.skewProtection as Record<string, unknown> || {}

  return {
    version: skewConfig.version || 'unknown',
    siteConfigUrl: siteConfig?.url || '',
    config: {
      cookie: skewConfig.cookie,
      debug: skewConfig.debug,
      connectionTracking: skewConfig.connectionTracking,
      routeTracking: skewConfig.routeTracking,
      ipTracking: skewConfig.ipTracking,
      reloadStrategy: skewConfig.reloadStrategy,
      multiTab: skewConfig.multiTab,
    },
    buildId: config.app?.buildId || 'dev',
  }
})
