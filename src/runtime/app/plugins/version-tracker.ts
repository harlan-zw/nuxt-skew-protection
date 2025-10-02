import { defineNuxtPlugin, reloadNuxtApp, useRuntimeConfig } from '#app'
import { ref } from 'vue'
import { useSkewProtectionCookie } from '../composables/useSkewProtectionCookie'

export default defineNuxtPlugin({
  name: 'skew-protection:plugin',
  setup(nuxtApp) {
    const isClient = import.meta.client

    // Get runtime config once at top level
    const runtimeConfig = useRuntimeConfig()
    const currentBuildId = runtimeConfig.app.buildId
    const skewConfig = runtimeConfig.public.skewProtection

    // Reactive state for version mismatch
    const versionMismatch = ref<{
      detected: boolean
      newVersion: string
      currentVersion: string
      reason?: 'manifest' | 'sse'
    }>({
      detected: false,
      newVersion: '',
      currentVersion: '',
    })

    // Track version in cookie for persistence across page loads
    const versionCookie = useSkewProtectionCookie(currentBuildId)

    // Set initial version if not already set
    if (!versionCookie.value) {
      versionCookie.value = currentBuildId
    }

    // Client-only: Hook into Nuxt's app:manifest:update event
    // This fires when:
    // 1. Nuxt's native polling detects a new build (check-outdated-build plugin)
    // 2. SSE plugin receives real-time update (our sse-version-updates plugin)
    // 3. Chunk errors are detected (Nuxt's chunk-reload plugin triggers manifest check)
    if (isClient) {
      nuxtApp.hook('app:manifest:update', async (manifest) => {
        const newBuildId = manifest.id
        const currentVersion = versionCookie.value

        if (newBuildId !== currentVersion) {
          await handleVersionMismatch(newBuildId, currentVersion, 'manifest')
        }
      })
    }

    // Handle version mismatch detection
    const handleVersionMismatch = async (
      newVersion: string,
      currentVersion: string,
      reason: 'manifest' | 'sse' = 'manifest',
    ) => {
      // Update reactive state
      versionMismatch.value = {
        detected: true,
        newVersion,
        currentVersion,
        reason,
      }

      const strategy = skewConfig?.notificationStrategy || 'modal'

      // For 'redirect' and 'silent' strategies, handle immediately
      // For 'modal' and 'toast', the UI components will handle via reactive state
      switch (strategy) {
        case 'redirect':
          // Refresh the page with new version
          versionCookie.value = newVersion
          reloadNuxtApp({ force: true })
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

    // Dismiss the version mismatch notification
    const dismiss = () => {
      versionMismatch.value = {
        detected: false,
        newVersion: '',
        currentVersion: '',
      }
    }

    // Update to a specific version (updates cookie and clears mismatch state)
    const updateVersion = (version: string) => {
      versionCookie.value = version
      dismiss()
    }

    // Reload the page
    const reload = () => {
      reloadNuxtApp({ force: true })
    }

    // Expose utilities and state for composables
    return {
      provide: {
        skewProtection: {
          // State
          versionMismatch,
          versionCookie,
          currentBuildId,
          // Methods
          handleVersionMismatch,
          updateVersion,
          dismiss,
          reload,
        },
      },
    }
  },
})
