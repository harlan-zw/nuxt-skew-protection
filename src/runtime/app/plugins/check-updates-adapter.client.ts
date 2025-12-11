// @ts-expect-error virtual module
import { config, subscribe } from '#skew-adapter'
import { defineNuxtPlugin, useRuntimeConfig } from 'nuxt/app'
import { logger } from '../../shared/logger'
import { checkForUpdates, useSkewProtection } from '../composables/useSkewProtection'
import { createBackoffQueue } from '../utils/backoff-queue'

export default defineNuxtPlugin({
  name: 'skew-protection:adapter-updates',
  setup(nuxtApp) {
    const { clientVersion } = useSkewProtection()
    // @ts-expect-error untyped
    const adapterName = useRuntimeConfig().public.skewProtection.adapterName
    const channel = (config as { channel?: string }).channel || 'skew-protection'

    logger.debug(`[${adapterName}] Subscribing to channel: ${channel}`)

    let cleanup: (() => void) | null = null
    const queue = createBackoffQueue({
      delays: [0, 5000, 30000, 300000],
      onTick: () => nuxtApp.runWithContext(checkForUpdates),
    })

    nuxtApp.hook('app:mounted', () => {
      cleanup = subscribe(config, (msg: { version: string }) => {
        if (!msg.version) {
          logger.debug(`[${adapterName}] Received message without version, ignoring`)
          return
        }
        logger.debug(`[${adapterName}] Received version: ${msg.version}`)

        if (msg.version !== clientVersion) {
          logger.debug(`[${adapterName}] Version mismatch (${msg.version} !== ${clientVersion}), starting backoff checks`)
          queue.start()
        }
      })
    })

    nuxtApp.hook('app:error', () => {
      queue.clear()
      cleanup?.()
    })

    if (import.meta.client) {
      window.addEventListener('beforeunload', () => {
        queue.clear()
        cleanup?.()
      })
    }
  },
})
