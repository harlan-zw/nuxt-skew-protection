import type { H3Event } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { getSkewProtectionCookie } from './cookie'

/**
 * Check if the client is outdated based on cookie version vs current build ID
 * @returns Object with outdated status and version info
 */
export function isClientOutdated(event: H3Event) {
  const config = useRuntimeConfig(event)
  const currentBuildId = config.app.buildId
  const clientVersion = getSkewProtectionCookie(event)
  return !!(clientVersion && currentBuildId && clientVersion !== currentBuildId)
}
