import type { NuxtAppManifestMeta } from 'nuxt/app'
import type { ChunksOutdatedPayload } from '../../types'
// @ts-expect-error virtual file
import { buildAssetsURL } from '#internal/nuxt/paths'
import { useOnline } from '@vueuse/core'
import { useNuxtApp, useRuntimeConfig, useState } from 'nuxt/app'
import { computed, onMounted, onUnmounted } from 'vue'
import { SKEW_MESSAGE_TYPE } from '../../const'
import { logger } from '../../shared/logger'
import { createBackoffQueue } from '../utils/backoff-queue'

export interface UseSkewProtectionOptions {
  /**
   * Lazy connection mode: don't auto-connect on mount.
   * When false (default), connections are established automatically on mount.
   * When true, users must call connect() manually.
   * @default false
   */
  lazy?: boolean
}

export function useSkewProtection(options: UseSkewProtectionOptions = {}) {
  const { lazy = false } = options
  const nuxtApp = useNuxtApp()
  const clientVersion = nuxtApp.$skewConnection?.buildId || nuxtApp.$skewConnection?.cookie?.value || useRuntimeConfig().app.buildId
  const isConnected = useState('skew-connected', () => false)
  const serverVersion = useState<string | undefined>('skew-server-version', () => undefined)
  const manifest = useState<NuxtAppManifestMeta | undefined>('skew-manifest', () => undefined)

  async function checkForUpdates() {
    // Don't check for updates when offline
    if (import.meta.client && !useOnline().value)
      return

    const meta = await ($fetch(`${buildAssetsURL('builds/latest.json')}?${Date.now()}`) as Promise<NuxtAppManifestMeta>).catch(() => {
      return null
    })
    if (meta && meta?.id !== clientVersion) {
      await nuxtApp.hooks.callHook('app:manifest:update', meta)
    }
  }

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
    if (msg.version) {
      serverVersion.value = msg.version as string
    }
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
   * Register a callback for when chunks become outdated.
   * Returns an unsubscribe function.
   */
  function onCurrentChunksOutdated(callback: (payload: ChunksOutdatedPayload) => void | Promise<void>) {
    const hook = nuxtApp.hooks.hook('skew:chunks-outdated', callback)

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

  // Rollback: server version is older than client version (based on manifest timestamps)
  const isRollback = computed(() => {
    if (!manifest.value?.skewProtection?.versions || !serverVersion.value)
      return false
    if (serverVersion.value === clientVersion)
      return false
    const versions = manifest.value.skewProtection.versions
    const serverTs = versions[serverVersion.value]?.timestamp
    const clientTs = versions[clientVersion]?.timestamp
    if (!serverTs || !clientTs)
      return false
    return new Date(serverTs).getTime() < new Date(clientTs).getTime()
  })

  const isAppOutdated = computed(() => !!(manifest.value && clientVersion !== manifest.value.id))

  const result = {
    manifest,
    clientVersion,
    serverVersion: computed(() => serverVersion.value),
    isConnected: computed(() => isConnected.value),
    isOnline: useOnline(),
    isAppOutdated,
    isRollback,
    connect,
    disconnect,
    onCurrentChunksOutdated,
    onAppOutdated,
    checkForUpdates,
    async simulateUpdate() {
      if (!import.meta.dev) {
        return
      }
      await nuxtApp.hooks.callHook('skew:chunks-outdated', {
        deletedChunks: [],
        invalidatedModules: [],
        passedReleases: [],
      })
    },
  }

  // v1 migration: deprecated `isOutdated` alias
  if (import.meta.dev) {
    let warned = false
    Object.defineProperty(result, 'isOutdated', {
      get() {
        if (!warned) {
          console.warn('[nuxt-skew-protection] `isOutdated` is deprecated, use `isAppOutdated` instead. See https://nuxtseo.com/docs/skew-protection/releases/v1')
          warned = true
        }
        return isAppOutdated
      },
      enumerable: false,
    })
  }

  return result
}
