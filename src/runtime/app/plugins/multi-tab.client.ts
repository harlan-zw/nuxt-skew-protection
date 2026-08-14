import type { NuxtAppManifestMeta } from 'nuxt/app'
import { useBroadcastChannel, useDocumentVisibility, useIdle } from '@vueuse/core'
import { defineNuxtPlugin, reloadNuxtApp, useNuxtApp, useRuntimeConfig } from 'nuxt/app'
import { ref, watch } from 'vue'
import { logger } from '../../shared/logger'

const CHANNEL_NAME = 'nuxt-skew-protection'

export default defineNuxtPlugin({
  name: 'skew-protection:multi-tab',
  setup() {
    if (import.meta.prerender)
      return

    const nuxtApp = useNuxtApp()
    const config = useRuntimeConfig().public.skewProtection as {
      basePath?: string
      multiTab?: boolean
      reloadStrategy?: 'prompt' | 'immediate' | 'idle' | false
    }
    const reloadStrategy = config.reloadStrategy ?? 'prompt'

    nuxtApp.hooks.hook('app:chunkError', () => {
      logger.debug('[AutoReload] Chunk failed to load, reloading')
      return reloadNuxtApp({ force: true })
    })

    if (reloadStrategy === 'immediate') {
      nuxtApp.hooks.hook('app:manifest:update', () => {
        logger.debug('[AutoReload] New deployment available, reloading immediately')
        return reloadNuxtApp({ force: true })
      })
    }
    else if (reloadStrategy === 'idle') {
      const pendingUpdate = ref(false)
      const { idle } = useIdle(5000)
      const visibility = useDocumentVisibility()
      const reloadWhenSafe = () => {
        if (!pendingUpdate.value || (!idle.value && visibility.value !== 'hidden'))
          return
        pendingUpdate.value = false
        logger.debug('[AutoReload] New deployment available, reloading while idle')
        return reloadNuxtApp({ force: true })
      }

      watch([idle, visibility], reloadWhenSafe)
      nuxtApp.hooks.hook('app:manifest:update', () => {
        pendingUpdate.value = true
        return reloadWhenSafe()
      })
    }

    if (config.multiTab === false)
      return

    const receivedIds = new Set<string>()
    const channelName = `${CHANNEL_NAME}:${config.basePath || '/__skew'}`
    const { data, post, close, isSupported } = useBroadcastChannel<NuxtAppManifestMeta | undefined, NuxtAppManifestMeta>({ name: channelName })

    if (!isSupported.value)
      return

    nuxtApp.hooks.hook('app:manifest:update', (manifest) => {
      if (!manifest?.id)
        return
      if (receivedIds.delete(manifest.id))
        return
      logger.debug('[MultiTab] Broadcasting deployment update to sibling tabs')
      post(manifest)
    })

    watch(data, (manifest) => {
      if (!manifest?.id)
        return
      logger.debug('[MultiTab] Received deployment update from a sibling tab')
      receivedIds.add(manifest.id)
      void nuxtApp.hooks.callHook('app:manifest:update', manifest)
    })

    nuxtApp.hook('app:error', close)
  },
})
