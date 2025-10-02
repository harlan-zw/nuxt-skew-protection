import { useStorage } from '#imports'
import { defineEventHandler } from 'h3'
import { getSkewProtectionCookie } from '../../composables/cookie'

export default defineEventHandler(async (event) => {
  // Detect provider
  const isCloudflare = !!(process.env.CF_WORKER_NAME && process.env.CF_PREVIEW_DOMAIN)

  // Cloudflare provider: check deployment mapping
  if (isCloudflare) {
    const currentDeploymentId = process.env.NUXT_DEPLOYMENT_ID
    const deploymentMapping = process.env.CF_DEPLOYMENT_MAPPING
      ? JSON.parse(process.env.CF_DEPLOYMENT_MAPPING)
      : {}

    const availableDeployments = Object.keys(deploymentMapping)

    return {
      provider: 'cloudflare',
      currentVersion: currentDeploymentId,
      availableVersions: availableDeployments,
      deploymentMapping,
      outdated: false, // Cloudflare handles routing automatically
      note: 'Cloudflare skew protection uses server-side routing. Client checking not needed.',
    }
  }

  // Generic/Vercel provider: use storage manifest
  const userVersion = getSkewProtectionCookie(event)
  const storage = useStorage('skew-protection')

  const manifest = await storage.getItem('versions-manifest.json').catch(() => null) as any

  if (!manifest) {
    return {
      provider: 'generic',
      error: 'No version manifest available',
      outdated: false,
    }
  }

  const isOutdated = userVersion && userVersion !== manifest.current
  const versionInfo = userVersion ? manifest.versions[userVersion] : null

  if (isOutdated) {
    // Trigger the same event as middleware
    const nitro = (event.context as any)?.nitro
    if (nitro) {
      await nitro.hooks.callHook('skew-protection:outdated-client', {
        clientVersion: userVersion,
        currentVersion: manifest.current,
        userAgent: event.node.req.headers['user-agent'],
        ip: event.node.req.headers['x-forwarded-for'] || event.node.req.connection?.remoteAddress,
        url: event.node.req.url,
        timestamp: new Date().toISOString(),
        source: 'api-check',
      })
    }
  }

  return {
    provider: 'generic',
    outdated: isOutdated,
    clientVersion: userVersion,
    currentVersion: manifest.current,
    versionExists: !!versionInfo,
    versionExpires: versionInfo?.expires,
    availableVersions: Object.keys(manifest.versions),
  }
})
