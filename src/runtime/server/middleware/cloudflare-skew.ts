import { defineEventHandler, getHeader, setResponseHeaders, setResponseStatus } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { getAssetDeploymentId } from '../../../utils/version-manager'
import { getSkewProtectionCookie, setSkewProtectionCookie } from '../composables/cookie'
import { logger } from '../logger'

/**
 * Handle asset requests without cookies by looking up in manifest
 * This is for when bots request assets from cached HTML without cookies
 */
async function handleAssetRequestWithoutCookie(event: any, url: URL, assetPath: string): Promise<Response | void> {
  // Step 1: Try to find the asset in the manifest
  const deploymentId = await getAssetDeploymentId(assetPath)

  if (deploymentId) {
    // Found in manifest! Route to this specific deployment
    return await routeToDeployment(event, url, deploymentId)
  }

  // Step 2: Manifest miss - fallback to searching all versions
  return await searchAllVersionsForAsset(event, url)
}

/**
 * Route request to a specific deployment
 */
async function routeToDeployment(event: any, url: URL, deploymentId: string): Promise<Response | void> {
  // Get deployment mapping
  let deploymentMapping: Record<string, string> = {}
  try {
    deploymentMapping = process.env.CF_DEPLOYMENT_MAPPING
      ? JSON.parse(process.env.CF_DEPLOYMENT_MAPPING)
      : {}
  }
  catch {
    return
  }

  const versionId = deploymentMapping[deploymentId]
  if (!versionId || versionId === 'current') {
    // It's the current version, let it pass through
    return
  }

  // Route to the versioned deployment
  const versionDomain = versionId.split('-')[0]
  const hostname = `${versionDomain}-${process.env.CF_WORKER_NAME}.${process.env.CF_PREVIEW_DOMAIN}.workers.dev`
  const versionUrl = new URL(url.toString())
  versionUrl.hostname = hostname

  const response = await fetch(versionUrl.toString()).catch(() => null)
  if (response?.ok) {
    setResponseStatus(event, response.status, response.statusText)

    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })
    setResponseHeaders(event, responseHeaders)

    return response.body as any
  }
}

/**
 * Fallback: Search through all available versions for the asset
 * This is for when the asset isn't in the manifest
 */
async function searchAllVersionsForAsset(event: any, url: URL): Promise<Response | void> {
  // Get deployment mapping
  let deploymentMapping: Record<string, string> = {}
  try {
    deploymentMapping = process.env.CF_DEPLOYMENT_MAPPING
      ? JSON.parse(process.env.CF_DEPLOYMENT_MAPPING)
      : {}
  }
  catch {
    // Invalid JSON - try current version only
    return
  }

  // Try current version first
  const currentResponse = await fetch(url.toString()).catch(() => null)
  if (currentResponse?.ok) {
    return
  }

  // Search through all available versions (newest to oldest)
  const versions = Object.entries(deploymentMapping).reverse()
  for (const [_deploymentId, versionId] of versions) {
    if (versionId === 'current' || !versionId) {
      continue
    }

    // Extract version domain and construct preview URL
    const versionDomain = versionId.split('-')[0]
    const hostname = `${versionDomain}-${process.env.CF_WORKER_NAME}.${process.env.CF_PREVIEW_DOMAIN}.workers.dev`
    const versionUrl = new URL(url.toString())
    versionUrl.hostname = hostname

    const response = await fetch(versionUrl.toString()).catch(() => null)
    if (response?.ok) {
      // Found the asset in this version!
      setResponseStatus(event, response.status, response.statusText)

      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })
      setResponseHeaders(event, responseHeaders)

      return response.body as any
    }
  }

  // Asset not found in any version - let it 404 naturally
}

/**
 * Cloudflare skew protection middleware (OpenNext pattern)
 *
 * Routes requests to the correct deployment version using Cloudflare Preview URLs
 * Based on: https://github.com/opennextjs/opennextjs-cloudflare
 */
export default defineEventHandler(async (event) => {
  const request = event.node.req
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)

  // Skip localhost
  if (url.hostname === 'localhost') {
    return
  }

  // Allow .workers.dev domains for testing (can be disabled via env var)
  const skipWorkersDevDomain = process.env.CF_SKIP_WORKERS_DEV === 'true'
  if (skipWorkersDevDomain && url.hostname.endsWith('.workers.dev')) {
    return
  }

  // Check if this is an asset request
  const buildAssetsDir = useRuntimeConfig().app.buildAssetsDir
  const isAssetRequest = url.pathname.startsWith(buildAssetsDir)

  // Detect bots/crawlers
  const userAgent = getHeader(event, 'user-agent') || ''
  const isBot = /bot|crawler|spider|crawling|googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|sogou|exabot|facebot|ia_archiver/i.test(userAgent)

  // For bots requesting HTML/documents, always serve current version (ignore any cookies)
  // But for assets, let them fall through to version checking (they might need old assets)
  if (isBot && !isAssetRequest) {
    return
  }

  // Check if this is a document request (HTML page)
  const secFetchDest = getHeader(event, 'sec-fetch-dest')
  const isDocumentRequest = secFetchDest === 'document'

  // For document requests, always serve current version and reset cookie
  if (isDocumentRequest) {
    const currentDeploymentId = process.env.NUXT_DEPLOYMENT_ID
    if (currentDeploymentId) {
      setSkewProtectionCookie(event, currentDeploymentId)
    }
    // Always serve current version for document requests
    return
  }

  // For non-document requests (assets, API), check for old version routing
  // Extract requested deployment ID from header, query param, or cookie
  const requestedDeploymentId
    = getHeader(event, 'x-deployment-id')
      || url.searchParams.get('dpl')
      || getSkewProtectionCookie(event)

  // Special case: Asset request without cookie (bots or users without cookies)
  // Look up the asset in the manifest to find which deployment it belongs to
  if (isAssetRequest && !requestedDeploymentId) {
    return await handleAssetRequestWithoutCookie(event, url, url.pathname)
  }

  // Skip if no deployment ID requested or it's the current one
  if (!requestedDeploymentId || requestedDeploymentId === process.env.NUXT_DEPLOYMENT_ID) {
    return
  }

  // Get deployment mapping from environment variable
  let deploymentMapping = {}
  try {
    deploymentMapping = process.env.CF_DEPLOYMENT_MAPPING
      ? JSON.parse(process.env.CF_DEPLOYMENT_MAPPING)
      : {}
  }
  catch {
    // Invalid JSON - skip routing
    return
  }

  // Skip if deployment ID not in mapping
  if (!(requestedDeploymentId in deploymentMapping)) {
    return
  }

  const versionId = (deploymentMapping as Record<string, string>)[requestedDeploymentId]

  // Skip if version is "current" or not set
  if (!versionId || versionId === 'current') {
    return
  }

  // Extract version domain from version ID (format: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")
  const versionDomain = versionId.split('-')[0]

  // Construct preview URL: {versionDomain}-{workerName}.{previewDomain}.workers.dev
  const hostname = `${versionDomain}-${process.env.CF_WORKER_NAME}.${process.env.CF_PREVIEW_DOMAIN}.workers.dev`
  url.hostname = hostname

  // Forward request to versioned worker
  const headers = new Headers(request.headers as HeadersInit)
  headers.delete('origin') // Remove origin header to prevent POST errors

  // For requests with body, we need to handle them differently
  let body: BodyInit | null | undefined
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    // For POST/PUT/PATCH requests, forward the raw body
    // Note: The request body may have already been consumed, so this is best-effort
    body = undefined
  }

  const response = await fetch(url.toString(), {
    method: request.method,
    headers,
    body,
  }).catch((error) => {
    logger.error('Failed to forward request:', error)
    return null
  })

  if (!response) {
    return
  }

  // Set response status and headers
  setResponseStatus(event, response.status, response.statusText)

  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value
  })
  setResponseHeaders(event, responseHeaders)

  // Return response body
  return response.body
})
