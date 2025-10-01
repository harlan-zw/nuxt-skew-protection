import type { NitroApp } from 'nitropack'

let currentVersion: string | null = null
let broadcastFunction: ((version: string) => number) | null = null

export default defineNitroPlugin((nitroApp: NitroApp) => {
  // Get current version from runtime config
  const config = useRuntimeConfig()
  currentVersion = config.app.buildId

  // Lazy load the broadcast function to avoid circular dependency
  const getBroadcastFunction = async () => {
    if (!broadcastFunction) {
      try {
        const wsModule = await import('../routes/_skew/ws')
        broadcastFunction = wsModule.broadcastVersionUpdate
      }
      catch (error) {
        console.error('[skew-protection:ws] Failed to load WebSocket broadcast function:', error)
      }
    }
    return broadcastFunction
  }

  // Hook into deployment updates
  // This will be triggered when a new version is detected
  nitroApp.hooks.hook('request', async (event) => {
    // Check if this is a request that might indicate a new deployment
    const path = event.node.req.url

    // Skip WebSocket and static asset requests
    if (path?.startsWith('/_skew/ws') || path?.startsWith('/_nuxt/') || path?.startsWith('/_skew/')) {
      return
    }

    // Check version on strategic requests (like status checks)
    if (path === '/_skew/status') {
      const newVersion = config.app.buildId

      if (newVersion && currentVersion && newVersion !== currentVersion) {
        // New version detected!
        const broadcast = await getBroadcastFunction()
        if (broadcast) {
          broadcast(newVersion)
        }
        currentVersion = newVersion
      }
    }
  })

  // Provide a way to manually trigger version broadcasts
  // This can be called from server middleware or API routes
  nitroApp.hooks.hook('skew:version-update', async (newVersion: string) => {
    const broadcast = await getBroadcastFunction()
    if (broadcast) {
      broadcast(newVersion)
      currentVersion = newVersion
    }
  })

  if (process.env.NODE_ENV === 'development') {
    console.log('[skew-protection:ws] WebSocket broadcaster plugin initialized')
  }
})

// Export utility function for manual broadcasts
export async function notifyVersionUpdate(version: string) {
  try {
    const wsModule = await import('../routes/_skew/ws')
    return wsModule.broadcastVersionUpdate(version)
  }
  catch (error) {
    console.error('[skew-protection:ws] Failed to notify version update:', error)
    return 0
  }
}
