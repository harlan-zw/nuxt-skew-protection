import { defineEventHandler, useRuntimeConfig } from 'nuxt/server'
import { getSkewSiteConfigUrl } from '#skew-protection/site-config'

/**
 * Devtools debug endpoint returning module configuration and resolved state.
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const skewConfig = config.public?.skewProtection as Record<string, unknown> || {}

  return {
    version: skewConfig.version || 'unknown',
    siteConfigUrl: getSkewSiteConfigUrl(event),
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
