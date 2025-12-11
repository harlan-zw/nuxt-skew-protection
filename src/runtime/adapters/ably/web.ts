import type { AblyAdapterConfig } from './types'
import { onNuxtReady } from 'nuxt/app'
import { defineWebSubscribe } from '../types'

export const subscribe = defineWebSubscribe<AblyAdapterConfig>((config, onMessage) => {
  let cleanup: (() => void) | undefined

  onNuxtReady(async () => {
    const { Realtime } = await import('ably')
    const ably = new Realtime({ key: config.key })
    const channelName = config.channel || 'skew-protection'
    const eventName = config.event || 'VersionUpdated'

    const channel = ably.channels.get(channelName)
    await channel.subscribe(eventName, (message) => {
      const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data
      onMessage({ version: data.version })
    })

    cleanup = () => {
      channel.unsubscribe()
      ably.close()
    }
  })

  return () => cleanup?.()
})
