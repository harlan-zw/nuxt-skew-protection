import { createError, defineEventHandler, getCookie, getHeader, getQuery, sendRedirect, setHeader } from 'h3'
import { DeploymentMappingManager } from '../../../utils/deployment-mapping'
import { getSkewProtectionStorage } from '../../../utils/storage'

/**
 * Route handler for serving versioned assets from /_skew/versions/* path
 * This handles requests that have already been rewritten by the skew-detector middleware
 */
export default defineEventHandler(async (event) => {
  // Get the catch-all path parameter
  const path = event.context.params?.path
  const versionedPath = Array.isArray(path) ? path.join('/') : path

  if (!versionedPath) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Asset not found',
    })
  }

  // Get deployment ID from multiple sources (header > query > cookie)
  const requestedDeploymentId = getRequestedDeploymentId(event)

  // Use storage to lookup versioned assets
  const storage = getSkewProtectionStorage()
  const deploymentMapping = new DeploymentMappingManager(storage)

  // Get manifest for version resolution
  const manifest = await storage.getItem('versions-manifest.json').catch(() => null) as any

  // If deployment mapping is enabled, resolve version from deployment ID
  let targetVersion = requestedDeploymentId

  if (requestedDeploymentId) {
    try {
      const mappedVersion = await deploymentMapping.getVersionForDeployment(requestedDeploymentId)
      if (mappedVersion && mappedVersion !== 'current') {
        targetVersion = mappedVersion
      }
      else if (mappedVersion === 'current' && manifest?.current) {
        targetVersion = manifest.current
      }
    }
    catch (error) {
      console.warn('[skew-protection] Failed to resolve deployment mapping:', error)
    }
  }

  // Try to serve the requested version
  if (targetVersion) {
    const versionedAsset = `${targetVersion}/${versionedPath}`
    const assetBuffer = await storage.getItemRaw(versionedAsset).catch(() => null)

    if (assetBuffer) {
      return serveAsset(event, assetBuffer, versionedPath)
    }
  }

  // Fallback: try to serve the exact requested path
  const assetBuffer = await storage.getItemRaw(versionedPath).catch(() => null)

  if (assetBuffer) {
    return serveAsset(event, assetBuffer, versionedPath)
  }

  // Asset not found - implement intelligent fallback behavior
  return handleAssetNotFound(event, versionedPath, manifest, requestedDeploymentId)
})

function getRequestedDeploymentId(event: any): string | null {
  // Check multiple sources in order of preference
  return (
    getHeader(event, 'x-deployment-id')
    || getQuery(event).dpl
    || getCookie(event, 'skew-version')
    || null
  )
}

function serveAsset(event: any, assetBuffer: Buffer, versionedPath: string) {
  // Set appropriate content type based on file extension
  const ext = versionedPath.split('.').pop()
  const contentType = getContentType(ext)
  if (contentType) {
    setHeader(event, 'content-type', contentType)
  }

  // Set cache headers for versioned assets (they're immutable)
  setHeader(event, 'cache-control', 'public, max-age=31536000, immutable')

  return assetBuffer
}

async function handleAssetNotFound(
  event: any,
  versionedPath: string,
  manifest: any,
  requestedDeploymentId: string | null,
) {
  // No manifest available - return 404
  if (!manifest) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Asset not found and no manifest available',
    })
  }

  // Extract version ID from path and try to redirect to current version
  const pathParts = versionedPath.split('/')
  if (pathParts.length > 1) {
    const assetPath = pathParts.slice(1).join('/')
    const fallbackUrl = `/_skew/versions/${manifest.current}/${assetPath}`
    return sendRedirect(event, fallbackUrl, 302)
  }

  // Final fallback: redirect to current version
  const fallbackUrl = `/_skew/versions/${manifest.current}/${versionedPath}`
  return sendRedirect(event, fallbackUrl, 302)
}

function getContentType(ext: string | undefined): string | null {
  const types: Record<string, string> = {
    js: 'application/javascript',
    mjs: 'application/javascript',
    css: 'text/css',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject',
  }

  return ext ? types[ext.toLowerCase()] || null : null
}
