import type { PusherAdapterConfig } from './types'
import { onNuxtReady } from 'nuxt/app'
import { defineWebSubscribe } from '../types'

export const subscribe = defineWebSubscribe<PusherAdapterConfig>((config, onMessage) => {
  let cleanup: (() => void) | undefined

  onNuxtReady(async () => {
    const Pusher = await import('pusher-js').then(m => m.default || m)
    const pusher = new Pusher(config.key, {
      cluster: config.cluster,
    })

    const channelName = config.channel || 'skew-protection'
    const eventName = config.event || 'VersionUpdated'

    const channel = pusher.subscribe(channelName)
    channel.bind(eventName, (data: { version: string }) => {
      onMessage({ version: data.version })
    })

    cleanup = () => {
      channel.unbind(eventName)
      pusher.unsubscribe(channelName)
    }
  })

  return () => cleanup?.()
})
