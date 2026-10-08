import type { NuxtAppManifestMeta } from 'nuxt/app'
import { until, useDocumentVisibility, useIdle } from '@vueuse/core'
import { defineNuxtPlugin, reloadNuxtApp, useNuxtApp, useRuntimeConfig, useState } from 'nuxt/app'
import { logger } from '../../shared/logger'

const CHANNEL_NAME = 'nuxt-skew-protection'
/** No input for this long counts as idle. */
const IDLE_TIMEOUT_MS = 60_000

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
    const runtimeConfig = useRuntimeConfig()
    const config = runtimeConfig.public.skewProtection as {
      multiTab?: boolean
      basePath?: string
      reloadStrategy?: 'prompt' | 'immediate' | 'idle' | false
    }

    const reloadStrategy = config.reloadStrategy ?? 'prompt'

    // Auto-reload handler for 'immediate' and 'idle' strategies
    if (reloadStrategy === 'immediate' || reloadStrategy === 'idle') {
      let waitingForIdle = false
      nuxtApp.hooks.hook('skew:chunks-outdated', () => {
        if (reloadStrategy === 'immediate') {
          logger.debug('[AutoReload] Chunks outdated, reloading immediately')
          reloadNuxtApp({ force: true, persistState: true })
        }
        else if (reloadStrategy === 'idle' && !waitingForIdle) {
          logger.debug('[AutoReload] Chunks outdated, waiting for idle or a hidden tab')
          waitingForIdle = true
          const { idle, stop } = useIdle(IDLE_TIMEOUT_MS)
          const visibility = useDocumentVisibility()
          until(() => idle.value || visibility.value === 'hidden').toBe(true).then(() => {
            stop()
            reloadNuxtApp({ force: true, persistState: true })
          })
        }
      })
    }

    // Multi-tab coordination via BroadcastChannel
    if (config.multiTab === false || typeof BroadcastChannel === 'undefined')
      return

    const channel = new BroadcastChannel(`${CHANNEL_NAME}:${runtimeConfig.app.baseURL}:${config.basePath || '/__skew'}`)

    // Guard to prevent re-broadcasting messages received from other tabs
    const receivedFromChannel = new WeakSet<object>()
    const manifestState = useState<NuxtAppManifestMeta | undefined>('skew-manifest', () => undefined)

    // When this tab detects an update, broadcast to other tabs
    const stopBroadcasting = nuxtApp.hooks.hook('app:manifest:update', (manifest) => {
      if (!manifest || receivedFromChannel.has(manifest))
        return
      manifestState.value = manifest
      logger.debug('[MultiTab] Broadcasting version update to other tabs')
      channel.postMessage({ ...manifest, type: 'version-update' })
    })

    // When another tab broadcasts an update, trigger hooks locally
    channel.onmessage = (event) => {
      if (event.data?.type === 'version-update' && event.data.id && event.data.id !== runtimeConfig.app.buildId) {
        if (event.data.id === manifestState.value?.id && (manifestState.value?.skewProtection || !event.data.skewProtection))
          return
        manifestState.value = event.data
        logger.debug('[MultiTab] Received version update from another tab')
        receivedFromChannel.add(event.data)
        nuxtApp.hooks.callHook('app:manifest:update', event.data)
      }
    }

    // Cleanup on app error. The listener goes with the channel: an outdated-build
    // poll after `close()` would otherwise post to a closed channel and surface
    // as an unhandled rejection.
    nuxtApp.hook('app:error', () => {
      stopBroadcasting()
      channel.close()
    })
  },
})
