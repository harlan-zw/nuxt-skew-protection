import { defineEventHandler, getHeader, setResponseHeaders, setResponseStatus } from 'h3'

/**
 * Cloudflare skew protection middleware (OpenNext pattern)
 *
 * Routes requests to the correct deployment version using Cloudflare Preview URLs
 * Based on: https://github.com/opennextjs/opennextjs-cloudflare
 */
export default defineEventHandler(async (event) => {
  const request = event.node.req
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)

  // Only active on custom domains (not localhost or *.workers.dev)
  if (url.hostname === 'localhost' || url.hostname.endsWith('.workers.dev')) {
    return
  }

  // Extract requested deployment ID from header or query param
  const requestedDeploymentId
    = getHeader(event, 'x-deployment-id')
      || url.searchParams.get('dpl')

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

  const versionId = deploymentMapping[requestedDeploymentId]

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

  const response = await fetch(url.toString(), {
    method: request.method,
    headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request : undefined,
  }).catch((error) => {
    console.error('[skew-protection] Failed to forward request:', error)
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
