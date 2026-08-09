interface CloudflareAssetBinding {
  fetch: (request: Request) => Promise<Response>
}

type CreateRetryId = () => string

const retryQuery = '__nuxt_skew_protection_retry'

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

function createRetryRequest(request: Request, retryId: string) {
  const url = new URL(request.url)
  url.searchParams.set(retryQuery, retryId)

  const retryRequest = new Request(url, request)
  retryRequest.headers.set('cache-control', 'no-cache')
  retryRequest.headers.set('pragma', 'no-cache')
  return retryRequest
}

export async function fetchCloudflareAsset(
  request: Request,
  assets: CloudflareAssetBinding,
  createRetryId: CreateRetryId = () => crypto.randomUUID(),
) {
  const response = await assets.fetch(request)

  if (response.status < 400) {
    return response
  }

  if (response.status !== 404) {
    return disableCaching(response)
  }

  const retryResponse = await assets.fetch(createRetryRequest(request, createRetryId()))
  return retryResponse.status < 400 ? retryResponse : disableCaching(retryResponse)
}

export function fetchCloudflareBuildAsset(
  request: Request,
  assets: CloudflareAssetBinding | undefined,
  buildAssetsDir: string,
): Promise<Response> | undefined {
  if (!assets || !new URL(request.url).pathname.startsWith(buildAssetsDir)) {
    return undefined
  }

  return fetchCloudflareAsset(request, assets)
}
