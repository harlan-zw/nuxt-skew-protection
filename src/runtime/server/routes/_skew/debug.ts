import { useStorage } from '#imports'
import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
  const storage = useStorage('skew-protection')

  const manifest = await storage.getItem('versions-manifest.json').catch(() => null) as any

  // Detect provider (priority: Cloudflare > Vercel > Generic)
  const isCloudflare = !!(process.env.CF_WORKER_NAME && process.env.CF_PREVIEW_DOMAIN)
  const isVercel = process.env.VERCEL_SKEW_PROTECTION_ENABLED === '1'

  let provider = 'generic'
  if (isCloudflare)
    provider = 'cloudflare'
  else if (isVercel)
    provider = 'vercel'

  // Get build/deployment ID
  const buildId = process.env.NUXT_DEPLOYMENT_ID
    || process.env.NUXT_BUILD_ID
    || process.env.VERCEL_DEPLOYMENT_ID

  // Get stats based on provider
  let stats
  if (isCloudflare) {
    const deploymentMapping = process.env.CF_DEPLOYMENT_MAPPING
      ? JSON.parse(process.env.CF_DEPLOYMENT_MAPPING)
      : {}
    stats = {
      availableVersions: Object.keys(deploymentMapping),
      currentVersion: process.env.NUXT_DEPLOYMENT_ID || null,
      totalVersions: Object.keys(deploymentMapping).length,
    }
  }
  else {
    stats = {
      availableVersions: manifest?.versions ? Object.keys(manifest.versions) : [],
      currentVersion: manifest?.current || null,
      totalVersions: manifest?.versions ? Object.keys(manifest.versions).length : 0,
    }
  }

  return {
    provider,
    buildId,
    manifest: isCloudflare ? null : manifest,
    stats,
    environment: {
      // Cloudflare
      CF_WORKER_NAME: process.env.CF_WORKER_NAME || null,
      CF_PREVIEW_DOMAIN: process.env.CF_PREVIEW_DOMAIN || null,
      CF_DEPLOYMENT_MAPPING: !!process.env.CF_DEPLOYMENT_MAPPING,
      NUXT_DEPLOYMENT_ID: process.env.NUXT_DEPLOYMENT_ID || null,
      // Vercel
      VERCEL_SKEW_PROTECTION_ENABLED: process.env.VERCEL_SKEW_PROTECTION_ENABLED === '1',
      VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID || null,
      // Build ID
      NUXT_BUILD_ID: process.env.NUXT_BUILD_ID || null,
    },
    cloudflare: isCloudflare
      ? {
          workerName: process.env.CF_WORKER_NAME,
          previewDomain: process.env.CF_PREVIEW_DOMAIN,
          deploymentId: process.env.NUXT_DEPLOYMENT_ID,
          deploymentMapping: process.env.CF_DEPLOYMENT_MAPPING
            ? JSON.parse(process.env.CF_DEPLOYMENT_MAPPING)
            : null,
        }
      : undefined,
  }
})
