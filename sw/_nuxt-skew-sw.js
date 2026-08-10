// sw.js
const loadedModules = new Set()
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

// Take control immediately on activation
// eslint-disable-next-line no-restricted-globals
self.addEventListener('activate', (event) => {
  // eslint-disable-next-line no-restricted-globals
  event.waitUntil(self.clients.claim())
})

// eslint-disable-next-line no-restricted-globals
self.addEventListener('fetch', (event) => {
  const url = event.request.url

  if (isRecoverableBuildAsset(event.request))
    event.respondWith(fetchBuildAsset(event.request))

  if (event.request.destination === 'script' || url.endsWith('.js')) {
    loadedModules.add(url)
    // Notify all clients about the new module
    event.waitUntil(
      // eslint-disable-next-line no-restricted-globals
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: 'MODULE_LOADED',
            url,
            modules: Array.from(loadedModules),
          })
        })
      }),
    )
  }
})

// Listen for messages from main app
// eslint-disable-next-line no-restricted-globals
self.addEventListener('message', (event) => {
  if (event.data.type === 'GET_MODULES') {
    // Send back all loaded modules
    const modules = Array.from(loadedModules)
    event.source.postMessage({
      type: 'MODULES_LIST',
      modules,
    })
  }

  if (event.data.type === 'CHECK_MODULE') {
    const isLoaded = loadedModules.has(event.data.url)
    event.source.postMessage({
      type: 'MODULE_STATUS',
      url: event.data.url,
      loaded: isLoaded,
    })
  }

  if (event.data.type === 'RESET_MODULES') {
    // Clear all loaded modules on version change
    loadedModules.clear()
    event.source.postMessage({
      type: 'MODULES_RESET',
      success: true,
    })
  }

  if (event.data.type === 'ADD_MODULE') {
    // Add a module that was loaded before SW activated
    loadedModules.add(event.data.url)
  }
})
