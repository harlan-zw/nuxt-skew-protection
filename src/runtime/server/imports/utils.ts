import type { H3Event } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { getSkewProtectionCookie } from './cookie'

/**
 * Get the client's deployment version from the skew protection cookie.
 * Returns undefined if no cookie is set.
 */
export function getClientVersion(event: H3Event): string | undefined {
  return getSkewProtectionCookie(event)
}

/**
 * Check if the client is outdated based on cookie version vs current build ID
 */
export function isClientOutdated(event: H3Event) {
  const config = useRuntimeConfig(event)
  const currentBuildId = config.app.buildId
  const clientVersion = getSkewProtectionCookie(event)
  return !!(clientVersion && currentBuildId && clientVersion !== currentBuildId)
}
