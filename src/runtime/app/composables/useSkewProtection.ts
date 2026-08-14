import type { NuxtApp, NuxtAppManifestMeta } from 'nuxt/app'
import { tryOnScopeDispose, useOnline } from '@vueuse/core'
import { onNuxtReady, useNuxtApp, useRuntimeConfig, useState } from 'nuxt/app'
import { computed } from 'vue'
// @ts-expect-error virtual file
import { buildAssetsURL } from '#internal/nuxt/paths'
import { SKEW_MESSAGE_TYPE } from '../../const'
import { logger } from '../../shared/logger'
import { createBackoffQueue } from '../utils/backoff-queue'

type SkewProtectionEngine = ReturnType<typeof createSkewProtectionEngine>
type SkewProtectionNuxtApp = NuxtApp & { _skewProtection?: SkewProtectionEngine }

function parseManifest(value: unknown): NuxtAppManifestMeta | null {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string')
    return null
  return value as NuxtAppManifestMeta
}

function createSkewProtectionEngine(nuxtApp: NuxtApp) {
  const connection = () => nuxtApp.$skewConnection
  const runtimeConfig = useRuntimeConfig()
  const clientVersion = connection()?.buildId || connection()?.cookie?.value || runtimeConfig.app.buildId
  const manifestURL = runtimeConfig.public.skewProtection.discoveryURL || buildAssetsURL('builds/latest.json')
  const isConnected = useState('skew-connected', () => false)
  const serverVersion = useState<string | undefined>('skew-server-version', () => undefined)
  const manifest = useState<NuxtAppManifestMeta | undefined>('skew-manifest', () => undefined)
  const isOnline = useOnline()

  let lastDetectedServerVersion: string | undefined
  let lastProcessedManifestId: string | undefined

  async function checkForUpdates() {
    if (runtimeConfig.public.skewProtection.updatesEnabled === false)
      return
    if (import.meta.client && !isOnline.value)
      return

    const response = await $fetch(`${manifestURL}${manifestURL.includes('?') ? '&' : '?'}${Date.now()}`)
      .catch((error: unknown) => {
        logger.debug('[SkewProtection] Latest manifest is not available yet; retrying.', error)
        return null
      })
    const meta = parseManifest(response)
    if (!meta) {
      if (response !== null)
        logger.debug('[SkewProtection] Ignoring an invalid latest manifest; retrying.')
      return
    }
    if (meta.id === clientVersion || meta.id === lastProcessedManifestId)
      return

    lastProcessedManifestId = meta.id
    queue.clear()
    await nuxtApp.hooks.callHook('app:manifest:update', meta)
  }

  const queue = createBackoffQueue({
    delays: [0, 5000, 30000, 300000],
    repeatLast: true,
    onTick: () => nuxtApp.runWithContext(checkForUpdates),
    onError: error => logger.debug('[SkewProtection] Update check failed; retrying.', error),
  })

  function connect() {
    if (isConnected.value || !connection())
      return
    connection()!.connect()
    isConnected.value = true
  }

  function disconnect() {
    if (!isConnected.value)
      return
    queue.clear()
    connection()?.disconnect()
    isConnected.value = false
  }

  onNuxtReady(connect)

  nuxtApp.hooks.hook('app:manifest:update', (nextManifest) => {
    if (!nextManifest || nextManifest.id === clientVersion)
      return
    manifest.value = nextManifest
    lastProcessedManifestId = nextManifest.id
    queue.clear()
  })

  nuxtApp.hooks.hook('skew:message', (message) => {
    if (message.type !== SKEW_MESSAGE_TYPE.VERSION && message.type !== SKEW_MESSAGE_TYPE.CONNECTED)
      return
    if (typeof message.version === 'string')
      serverVersion.value = message.version
    if (typeof message.version !== 'string' || message.version === clientVersion)
      return
    if (message.version === lastDetectedServerVersion)
      return

    lastDetectedServerVersion = message.version
    logger.debug(`[SkewProtection] Version mismatch (${message.version} !== ${clientVersion}), checking for the deployed manifest`)
    queue.start()
  })

  function onAppOutdated(callback: (nextManifest?: NuxtAppManifestMeta) => void | Promise<void>) {
    const remove = nuxtApp.hooks.hook('app:manifest:update', callback)
    tryOnScopeDispose(remove)
    return remove
  }

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

  return {
    manifest,
    clientVersion,
    serverVersion: computed(() => serverVersion.value),
    isConnected: computed(() => isConnected.value),
    isOnline,
    isAppOutdated: computed(() => !!(manifest.value && clientVersion !== manifest.value.id)),
    isRollback,
    connect,
    disconnect,
    onAppOutdated,
    checkForUpdates,
    async simulateUpdate() {
      if (!import.meta.dev)
        return
      await nuxtApp.hooks.callHook('app:manifest:update', {
        id: `simulated-${Date.now()}`,
        timestamp: Date.now(),
      })
    },
  }
}

// Reactive state is created once inside createSkewProtectionEngine.
// eslint-disable-next-line harlanzw/vue-no-faux-composables
export function useSkewProtection() {
  const nuxtApp = useNuxtApp() as SkewProtectionNuxtApp
  nuxtApp._skewProtection ||= createSkewProtectionEngine(nuxtApp)
  return nuxtApp._skewProtection
}
