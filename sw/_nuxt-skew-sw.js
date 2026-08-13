const serviceWorkerUrl = new URL(globalThis.location.href)
const buildAssetsPath = serviceWorkerUrl.searchParams.get('buildAssetsPath')
const recoveryPath = serviceWorkerUrl.searchParams.get('recoveryPath')

function isRecoverableBuildAsset(request) {
  if (!buildAssetsPath || !recoveryPath || request.method !== 'GET')
    return false

  const url = new URL(request.url)
  return url.origin === globalThis.location.origin
    && url.pathname.startsWith(buildAssetsPath)
}

function withoutResponseUrl(response) {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

async function fetchBuildAsset(request) {
  const response = await fetch(request)
  if (response.status !== 404)
    return response

  const url = new URL(recoveryPath, request.url)
  url.searchParams.set('url', request.url)
  const recoveryRequest = new Request(url, {
    cache: 'no-cache',
    headers: request.headers,
  })
  return withoutResponseUrl(await fetch(recoveryRequest))
}

// eslint-disable-next-line no-restricted-globals
self.addEventListener('activate', (event) => {
  // eslint-disable-next-line no-restricted-globals
  event.waitUntil(self.clients.claim())
})

// eslint-disable-next-line no-restricted-globals
self.addEventListener('fetch', (event) => {
  if (isRecoverableBuildAsset(event.request))
    event.respondWith(fetchBuildAsset(event.request))
})
