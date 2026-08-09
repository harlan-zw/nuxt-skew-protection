interface CloudflareAssetBinding {
  fetch: (request: Request) => Promise<Response>
}

function disableCaching(response: Response) {
  const headers = new Headers(response.headers)
  headers.set('cache-control', 'no-store')
  headers.set('cdn-cache-control', 'no-store')
  headers.set('cloudflare-cdn-cache-control', 'no-store')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function createRetryRequest(request: Request) {
  return new Request(request, { cache: 'no-cache' })
}

export async function fetchCloudflareAsset(
  request: Request,
  assets: CloudflareAssetBinding,
) {
  const response = await assets.fetch(request)

  if (response.status < 400) {
    return response
  }

  if (response.status !== 404) {
    return disableCaching(response)
  }

  const retryResponse = await assets.fetch(createRetryRequest(request))
  return retryResponse.status < 400 ? retryResponse : disableCaching(retryResponse)
}

export function fetchCloudflareBuildAsset(
  request: Request,
  assets: CloudflareAssetBinding | undefined,
  buildAssetsDir: string,
): Promise<Response> | undefined {
  if (!new URL(request.url).pathname.startsWith(buildAssetsDir)) {
    return undefined
  }

  if (!assets) {
    return Promise.resolve(disableCaching(new Response(null, { status: 404 })))
  }

  return fetchCloudflareAsset(request, assets)
}
