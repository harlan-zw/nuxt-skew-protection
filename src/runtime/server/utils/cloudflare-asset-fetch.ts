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

function protectMutableAsset(request: Request, response: Response) {
  return new URL(request.url).pathname.endsWith('/builds/latest.json')
    ? disableCaching(response)
    : response
}

type ParsedBuildAssetRequest
  = | { _tag: 'asset', request: Request }
    | { _tag: 'invalid-recovery' }
    | { _tag: 'unmatched' }

function parseBuildAssetRequest(
  request: Request,
  buildAssetsPath: string,
  recoveryPath: string,
): ParsedBuildAssetRequest {
  const requestUrl = new URL(request.url)

  if (requestUrl.pathname.startsWith(buildAssetsPath)) {
    return { _tag: 'asset', request }
  }

  if (requestUrl.pathname !== recoveryPath) {
    return { _tag: 'unmatched' }
  }

  if (request.method !== 'GET') {
    return { _tag: 'invalid-recovery' }
  }

  const target = requestUrl.searchParams.get('url')
  if (!target) {
    return { _tag: 'invalid-recovery' }
  }

  if (!URL.canParse(target, requestUrl)) {
    return { _tag: 'invalid-recovery' }
  }

  const targetUrl = new URL(target, requestUrl)
  if (
    targetUrl.origin !== requestUrl.origin
    || !targetUrl.pathname.startsWith(buildAssetsPath)
    || targetUrl.username
    || targetUrl.password
  ) {
    return { _tag: 'invalid-recovery' }
  }

  return {
    _tag: 'asset',
    request: new Request(targetUrl, {
      cache: 'no-cache',
      headers: request.headers,
    }),
  }
}

export async function fetchCloudflareAsset(
  request: Request,
  assets: CloudflareAssetBinding,
) {
  const response = await assets.fetch(request)

  if (response.status < 400) {
    return protectMutableAsset(request, response)
  }

  if (response.status !== 404) {
    return disableCaching(response)
  }

  const retryResponse = await assets.fetch(createRetryRequest(request))
  return retryResponse.status < 400
    ? protectMutableAsset(request, retryResponse)
    : disableCaching(retryResponse)
}

export function fetchCloudflareBuildAsset(
  request: Request,
  assets: CloudflareAssetBinding | undefined,
  buildAssetsPath: string,
  recoveryPath: string,
): Promise<Response> | undefined {
  const parsed = parseBuildAssetRequest(request, buildAssetsPath, recoveryPath)

  if (parsed._tag === 'unmatched') {
    return
  }

  if (parsed._tag === 'invalid-recovery') {
    return Promise.resolve(disableCaching(new Response(null, { status: 400 })))
  }

  if (!assets) {
    return Promise.resolve(disableCaching(new Response(null, { status: 404 })))
  }

  return fetchCloudflareAsset(parsed.request, assets)
}
