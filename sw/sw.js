// sw.js
const loadedModules = new Set()

// eslint-disable-next-line no-restricted-globals
self.addEventListener('fetch', (event) => {
  const url = event.request.url

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
    event.source.postMessage({
      type: 'MODULES_LIST',
      modules: Array.from(loadedModules),
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
})
