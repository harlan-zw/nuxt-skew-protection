import type { H3Event } from 'h3'
import { getCookie } from 'h3'
import { useRuntimeConfig } from '#imports'

/**
 * Check if the client is outdated based on cookie version vs current build ID
 * @returns Object with outdated status and version info
 */
export function isClientOutdated(event: H3Event) {
  const config = useRuntimeConfig(event)
  const currentBuildId = config.app.buildId
  const clientVersion = getCookie(event, 'skew-version')

  const outdated = !!(clientVersion && currentBuildId && clientVersion !== currentBuildId)

  return {
    outdated,
    clientVersion: clientVersion || null,
    currentVersion: currentBuildId || null,
  }
}

/**
 * Trigger outdated client event via Nitro hooks
 */
export async function triggerOutdatedClientEvent(
  event: H3Event,
  clientVersion: string,
  currentVersion: string,
) {
  console.log(
    `[skew-protection] Outdated client detected: ${clientVersion} (current: ${currentVersion})`,
  )

  const nitro = (event.context as any)?.nitro
  if (nitro) {
    await nitro.hooks.callHook('skew-protection:outdated-client', {
      clientVersion,
      currentVersion,
      userAgent: event.node.req.headers['user-agent'],
      ip: event.node.req.headers['x-forwarded-for'] || event.node.req.connection?.remoteAddress,
      url: event.node.req.url,
      timestamp: new Date().toISOString(),
    })
  }
}
