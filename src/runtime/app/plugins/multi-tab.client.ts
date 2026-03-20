import { defineNuxtPlugin, reloadNuxtApp, useNuxtApp, useRuntimeConfig } from 'nuxt/app'
import { logger } from '../../shared/logger'

const CHANNEL_NAME = 'nuxt-skew-protection'

/**
 * Multi-tab coordination via BroadcastChannel.
 * When one tab detects a version update, all tabs are notified.
 * Also handles auto-reload strategies (immediate, idle).
 */
export default defineNuxtPlugin({
  name: 'skew-protection:multi-tab',
  setup() {
    if (import.meta.prerender)
      return

    const nuxtApp = useNuxtApp()
    const config = useRuntimeConfig().public.skewProtection as {
      multiTab?: boolean
      reloadStrategy?: 'prompt' | 'immediate' | 'idle' | false
    }

    const reloadStrategy = config.reloadStrategy ?? 'prompt'

    // Auto-reload handler for 'immediate' and 'idle' strategies
    if (reloadStrategy === 'immediate' || reloadStrategy === 'idle') {
      nuxtApp.hooks.hook('skew:chunks-outdated', () => {
        if (reloadStrategy === 'immediate') {
          logger.debug('[AutoReload] Chunks outdated, reloading immediately')
          reloadNuxtApp({ force: true, persistState: true })
        }
        else if (reloadStrategy === 'idle') {
          logger.debug('[AutoReload] Chunks outdated, waiting for idle')
          const reload = () => {
            // Only reload if page is hidden (user switched tab) or idle
            if (document.hidden) {
              reloadNuxtApp({ force: true, persistState: true })
            }
            else {
              // Wait for page to become hidden, then reload
              const onVisibilityChange = () => {
                if (document.hidden) {
                  document.removeEventListener('visibilitychange', onVisibilityChange)
                  reloadNuxtApp({ force: true, persistState: true })
                }
              }
              document.addEventListener('visibilitychange', onVisibilityChange)
            }
          }
          if ('requestIdleCallback' in window) {
            requestIdleCallback(reload, { timeout: 10000 })
          }
          else {
            setTimeout(reload, 5000)
          }
        }
      })
    }

    // Multi-tab coordination via BroadcastChannel
    if (config.multiTab === false || typeof BroadcastChannel === 'undefined')
      return

    const channel = new BroadcastChannel(CHANNEL_NAME)

    // When this tab detects an update, broadcast to other tabs
    nuxtApp.hooks.hook('app:manifest:update', (manifest) => {
      logger.debug('[MultiTab] Broadcasting version update to other tabs')
      channel.postMessage({ type: 'version-update', id: manifest.id, timestamp: manifest.timestamp })
    })

    // When another tab broadcasts an update, trigger hooks locally
    channel.onmessage = (event) => {
      if (event.data?.type === 'version-update' && event.data.id) {
        logger.debug('[MultiTab] Received version update from another tab')
        nuxtApp.hooks.callHook('app:manifest:update', event.data)
      }
    }

    // Cleanup on app error
    nuxtApp.hook('app:error', () => {
      channel.close()
    })
  },
})
