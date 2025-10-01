import { defineNuxtPlugin, useCookie, useNuxtApp, useRuntimeConfig } from '#app'
import { ref, onUnmounted } from 'vue'

export default defineNuxtPlugin({
  name: 'nuxt:skew-protection',
  setup(nuxtApp) {
    // Reactive state for version mismatch
    const versionMismatch = ref<{
      detected: boolean
      newVersion: string
      currentVersion: string
      reason?: 'manifest' | 'chunk-error' | 'manual' | 'websocket'
    }>({
      detected: false,
      newVersion: '',
      currentVersion: '',
    })

    // WebSocket connection state
    const wsConnected = ref(false)
    let ws: WebSocket | null = null
    let wsReconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let wsHeartbeatInterval: ReturnType<typeof setInterval> | null = null

    // Get the current build ID from runtime config
    const { app } = useRuntimeConfig()
    const currentBuildId = app.buildId

    // Track version in cookie for persistence across page loads
    const versionCookie = useCookie('skew-version', {
      default: () => currentBuildId,
      maxAge: 60 * 60 * 24 * 60, // 60 days
    })

    // Set initial version if not already set
    if (!versionCookie.value) {
      versionCookie.value = currentBuildId
    }

    // Track chunk errors (similar to Nuxt's chunk-reload plugin)
    const chunkErrors = new Set<Error>()

    // Hook into Nuxt's chunk error detection
    nuxtApp.hook('app:chunkError', ({ error }) => {
      chunkErrors.add(error)
      // Chunk error indicates the client is likely out of date
      // Trigger version check to confirm
      checkLatestBuild().catch(() => {
        // If we can't check, assume we're outdated and show notification
        handleVersionMismatch('unknown', versionCookie.value, 'chunk-error')
      })
    })

    // Hook into Nuxt's existing app:manifest:update event
    // This fires when Nuxt detects a new version via its built-in manifest polling
    nuxtApp.hook('app:manifest:update', async (manifest) => {
      const newBuildId = manifest.id
      const currentVersion = versionCookie.value

      if (newBuildId !== currentVersion) {
        await handleVersionMismatch(newBuildId, currentVersion, 'manifest')
      }
    })

    // Handle version mismatch detection
    const handleVersionMismatch = async (
      newVersion: string,
      currentVersion: string,
      reason: 'manifest' | 'chunk-error' | 'manual' = 'manual',
    ) => {
      // Update reactive state
      versionMismatch.value = {
        detected: true,
        newVersion,
        currentVersion,
        reason,
      }

      // Get module options from runtime config
      const runtimeConfig = useRuntimeConfig()
      const strategy = runtimeConfig.skewProtection?.notificationStrategy || 'modal'

      // For 'redirect' and 'silent' strategies, handle immediately
      // For 'modal' and 'toast', the UI components will handle via reactive state
      switch (strategy) {
        case 'redirect':
          // Hard redirect to refresh the page with new version
          versionCookie.value = newVersion
          window.location.reload()
          break

        case 'silent':
          // Silently update cookie
          versionCookie.value = newVersion
          versionMismatch.value.detected = false
          break

        case 'modal':
        case 'toast':
          // Let the UI components (SkewNotificationRoot) handle this via reactive state
          // Components will watch versionMismatch.detected and show UI accordingly
          break
      }
    }

    // Check version status using our API endpoint
    const checkVersionStatus = async () => {
      const runtimeConfig = useRuntimeConfig()
      const response = await $fetch('/_skew/status').catch((error) => {
        if (runtimeConfig.skewProtection?.debug) {
          console.warn('[skew-protection] Failed to check version status:', error)
        }
        return null
      })

      if (response?.outdated) {
        await handleVersionMismatch(response.currentVersion, response.clientVersion, 'manual')
      }

      return response
    }

    // Check for updates using Nuxt's manifest (aligns with Nuxt's built-in checking)
    // This supplements Nuxt's built-in checking and can be called manually
    const checkLatestBuild = async () => {
      try {
        const latest = await $fetch('/_nuxt/builds/latest.json')
        if (latest.id !== versionCookie.value) {
          await handleVersionMismatch(latest.id, versionCookie.value, 'manual')
        }
      }
      catch (error) {
        const runtimeConfig = useRuntimeConfig()
        if (runtimeConfig.skewProtection?.debug) {
          console.warn('[skew-protection] Failed to check for updates:', error)
        }
      }
    }

    // Dismiss the version mismatch notification
    const dismiss = () => {
      versionMismatch.value = {
        detected: false,
        newVersion: '',
        currentVersion: '',
      }
      // Clear chunk errors when dismissed
      chunkErrors.clear()
    }

    // Update to a specific version (updates cookie and clears mismatch state)
    const updateVersion = (version: string) => {
      versionCookie.value = version
      dismiss()
    }

    // Reload the page
    const reload = () => {
      window.location.reload()
    }

    // WebSocket connection management
    const connectWebSocket = () => {
      const runtimeConfig = useRuntimeConfig()

      // Only connect if WebSocket is enabled
      if (!runtimeConfig.public.skewProtection?.enableWebSocket) {
        return
      }

      // Cleanup existing connection
      disconnectWebSocket()

      try {
        // Determine WebSocket URL
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const wsUrl = `${protocol}//${window.location.host}/_skew/ws`

        ws = new WebSocket(wsUrl)

        ws.onopen = () => {
          wsConnected.value = true
          if (runtimeConfig.public.skewProtection?.debug) {
            console.log('[skew-protection:ws] WebSocket connected')
          }

          // Start heartbeat
          wsHeartbeatInterval = setInterval(() => {
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping' }))
            }
          }, 30000) // Ping every 30 seconds
        }

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)

            if (data.type === 'version-update' && data.version) {
              // New version detected via WebSocket!
              if (data.version !== versionCookie.value) {
                handleVersionMismatch(data.version, versionCookie.value, 'websocket')
              }
            }
            else if (data.type === 'connected') {
              if (runtimeConfig.public.skewProtection?.debug) {
                console.log('[skew-protection:ws] Connection acknowledged')
              }
            }
          }
          catch (error) {
            console.error('[skew-protection:ws] Error parsing message:', error)
          }
        }

        ws.onerror = (error) => {
          console.error('[skew-protection:ws] WebSocket error:', error)
          wsConnected.value = false
        }

        ws.onclose = () => {
          wsConnected.value = false
          if (runtimeConfig.public.skewProtection?.debug) {
            console.log('[skew-protection:ws] WebSocket closed, reconnecting in 5s...')
          }

          // Cleanup heartbeat
          if (wsHeartbeatInterval) {
            clearInterval(wsHeartbeatInterval)
            wsHeartbeatInterval = null
          }

          // Attempt to reconnect after 5 seconds
          wsReconnectTimeout = setTimeout(() => {
            connectWebSocket()
          }, 5000)
        }
      }
      catch (error) {
        console.error('[skew-protection:ws] Failed to connect WebSocket:', error)
        wsConnected.value = false
      }
    }

    const disconnectWebSocket = () => {
      if (wsHeartbeatInterval) {
        clearInterval(wsHeartbeatInterval)
        wsHeartbeatInterval = null
      }

      if (wsReconnectTimeout) {
        clearTimeout(wsReconnectTimeout)
        wsReconnectTimeout = null
      }

      if (ws) {
        ws.close()
        ws = null
      }

      wsConnected.value = false
    }

    // Initialize WebSocket connection if enabled
    const runtimeConfig = useRuntimeConfig()
    if (runtimeConfig.public.skewProtection?.enableWebSocket) {
      // Connect on next tick to ensure app is mounted
      nuxtApp.hook('app:mounted', () => {
        connectWebSocket()
      })

      // Cleanup on unmount
      nuxtApp.hook('app:unmounted', () => {
        disconnectWebSocket()
      })
    }

    // Expose utilities and state for composables
    return {
      provide: {
        skewProtection: {
          // State
          versionMismatch,
          versionCookie,
          currentBuildId,
          wsConnected,
          // Methods
          checkForUpdates: checkLatestBuild,
          checkVersionStatus,
          handleVersionMismatch,
          updateVersion,
          dismiss,
          reload,
          connectWebSocket,
          disconnectWebSocket,
        },
      },
    }
  },
})
