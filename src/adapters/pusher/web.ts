import type { PusherAdapterConfig } from './types'
import { useScript } from '@unhead/vue'
import { onNuxtReady, useNuxtApp } from 'nuxt/app'
import { ref } from 'vue'
import { defineWebSubscribe } from '../types'

declare global {
  interface Window {
    Pusher: typeof import('pusher-js').default
  }
}

export const subscribe = defineWebSubscribe<PusherAdapterConfig>((config, onMessage) => {
  let cleanup: (() => void) | undefined

  let script: ReturnType<typeof useScript> | undefined
  const nuxtApp = useNuxtApp()
  const load = ref(false)
  nuxtApp.runWithContext(() => {
    script = useScript('https://js.pusher.com/8.4.0/pusher.min.js', {
      trigger: load,
    })
    onNuxtReady(() => {
      load.value = true
    })
  })

  if (script) {
    script.onLoaded(async () => {
      const { default: Echo } = await import('laravel-echo')

      const echo = new Echo({
        broadcaster: 'pusher',
        key: config.key,
        cluster: config.cluster,
        Pusher: window.Pusher,
      })

      const channelName = config.channel || 'skew-protection'
      const eventName = config.event || 'VersionUpdated'

      echo.channel(channelName).listen(`.${eventName}`, (e: { version: string }) => {
        onMessage({ version: e.version })
      })

      cleanup = () => echo.leave(channelName)
    })
  }

  return () => cleanup?.()
})
