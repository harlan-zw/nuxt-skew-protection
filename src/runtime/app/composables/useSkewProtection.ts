import type { NuxtAppManifestMeta } from 'nuxt/app'
import type { ChunksOutdatedPayload } from '../../types'
// @ts-expect-error virtual file
import { buildAssetsURL } from '#internal/nuxt/paths'
import { useOnline } from '@vueuse/core'
import { useNuxtApp } from 'nuxt/app'
import { computed, onUnmounted, ref } from 'vue'
import { useRuntimeConfigSkewProtection } from './useRuntimeConfigSkewProtection'
import { useNuxtApp, useRuntimeConfig } from 'nuxt/app'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { SKEW_MESSAGE_TYPE } from '../../const'
import { logger } from '../../shared/logger'
import { createBackoffQueue } from '../utils/backoff-queue'

export interface UseSkewProtectionOptions {
  /**
   * Lazy connection mode - don't auto-connect on mount
   * When false (default), connections are established automatically on mount
   * When true, users must call connect() manually
   * @default false
   */
}

const isConnected = ref(false)

export async function checkForUpdates() {
  // Don't check for updates when offline
  if (import.meta.client && !useOnline().value)
    return

  const nuxtApp = useNuxtApp()
  const clientVersion = nuxtApp.$skewConnection?.buildId || useRuntimeConfig().app.buildId
  const meta = await $fetch<NuxtAppManifestMeta>(`${buildAssetsURL('builds/latest.json')}?${Date.now()}`).catch(() => {
    return null
  })
  if (meta && meta?.id !== clientVersion) {
    await nuxtApp.hooks.callHook('app:manifest:update', meta)
  }
}

export function useSkewProtection(options: UseSkewProtectionOptions = {}) {
  const { lazy = false } = options
  const nuxtApp = useNuxtApp()
  const clientVersion = nuxtApp.$skewConnection?.buildId || nuxtApp.$skewConnection?.cookie?.value || useRuntimeConfig().app.buildId
  const manifest = ref<NuxtAppManifestMeta | undefined>()

  const queue = createBackoffQueue({
    delays: [0, 5000, 30000, 300000],
    onTick: () => nuxtApp.runWithContext(checkForUpdates),
  })

  // Auto-connect on mount unless lazy
  if (!lazy) {
    onMounted(() => {
      nuxtApp.$skewConnection?.connect()
    })
  }

  // Listen for version updates from connection
  nuxtApp.hooks.hook('skew:message', (msg) => {
    if (msg.type !== SKEW_MESSAGE_TYPE.VERSION && msg.type !== SKEW_MESSAGE_TYPE.CONNECTED)
      return
    if (!msg.version || msg.version === clientVersion)
      return

    logger.debug(`[SkewProtection] Version mismatch (${msg.version} !== ${clientVersion}), starting backoff checks`)
    queue.start()
  })

  function connect() {
    if (!import.meta.client || isConnected.value)
      return
    isConnected.value = true
    nuxtApp.$skewConnection?.connect()
  }

  function disconnect() {
    if (!import.meta.client || !isConnected.value)
      return
    isConnected.value = false
    queue.clear()
    nuxtApp.$skewConnection?.disconnect()
  }

  /**
   * Register a callback for when chunks become outdated
   * Returns an unsubscribe function
   */
  function onCurrentChunksOutdated(callback: (payload: ChunksOutdatedPayload) => void | Promise<void>) {
    const hook = nuxtApp.hooks.hook('skew-protection:chunks-outdated', callback)

    onUnmounted(() => {
      if (typeof hook === 'function') {
        hook()
      }
    })

    return hook
  }

  function onAppOutdated(callback: (manifest?: NuxtAppManifestMeta) => void | Promise<void>) {
    const hook = nuxtApp.hooks.hook('app:manifest:update', (_manifest) => {
      manifest.value = _manifest
      callback(_manifest)
    })

    onUnmounted(() => {
      if (typeof hook === 'function') {
        hook()
      }
    })

    return hook
  }

  return {
    manifest,
    clientVersion,
    isConnected: computed(() => isConnected.value),
    isOnline: useOnline(),
    isOutdated: computed(() => manifest.value && clientVersion !== manifest.value.id),
    connect,
    disconnect,
    onCurrentChunksOutdated,
    onAppOutdated,
    checkForUpdates,
    async simulateUpdate() {
      if (!import.meta.dev) {
        return
      }
      await nuxtApp.hooks.callHook('skew-protection:chunks-outdated', {
        deletedChunks: [],
        invalidatedModules: [],
        passedReleases: [],
      })
    },
  }
}
