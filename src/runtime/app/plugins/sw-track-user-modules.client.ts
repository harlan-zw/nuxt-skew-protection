import { defineNuxtPlugin } from 'nuxt/app'
import { logger } from '../../shared/logger'
import { useRuntimeConfigSkewProtection } from '../composables/useRuntimeConfigSkewProtection'

export default defineNuxtPlugin({
  name: 'skew-protection:asset-recovery',
  setup() {
    if (import.meta.prerender)
      return

    if (!('serviceWorker' in navigator)) {
      logger.debug('[SW] Service Worker not supported in this browser')
      return
    }

    const { assetRecovery } = useRuntimeConfigSkewProtection()
    if (assetRecovery._tag === 'disabled')
      return

    const serviceWorkerUrl = new URL('/_nuxt-skew-sw.js', window.location.origin)
    serviceWorkerUrl.searchParams.set('buildAssetsPath', assetRecovery.buildAssetsPath)
    serviceWorkerUrl.searchParams.set('recoveryPath', assetRecovery.recoveryPath)

    navigator.serviceWorker.register(serviceWorkerUrl.href)
      .then(() => logger.debug('[SW] Asset recovery service worker registered'))
      .catch(error => logger.debug('[SW] Asset recovery service worker registration failed:', error))
  },
})
