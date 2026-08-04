import type { SkewProtectionEvent } from './getRuntimeConfigSkewProtection'
import { useRuntimeConfig } from '#nuxtseo/nitro'
import { getSkewProtectionCookie } from './cookie'

/**
 * Get the client's deployment version from the skew protection cookie.
 * Returns undefined if no cookie is set.
 */
export function getClientVersion(event: SkewProtectionEvent): string | undefined {
  return getSkewProtectionCookie(event)
}

/**
 * Check if the client is outdated based on cookie version vs current build ID
 */
export function isClientOutdated(event: SkewProtectionEvent) {
  const config = useRuntimeConfig(event as Parameters<typeof useRuntimeConfig>[0])
  const currentBuildId = config.app.buildId
  const clientVersion = getSkewProtectionCookie(event)
  return !!(clientVersion && currentBuildId && clientVersion !== currentBuildId)
}
