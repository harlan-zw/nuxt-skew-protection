import type { SkewUpdateMessage } from '../types'
import type { AblyAdapterConfig } from './types'
import { onNuxtReady } from 'nuxt/app'
import { SKEW_DEFAULT_CHANNEL, SKEW_MESSAGE_TYPE } from '../../const'
import { defineWebSubscribe } from '../types'

export const subscribe = defineWebSubscribe<AblyAdapterConfig>((config, onMessage) => {
  let cleanup: (() => void) | undefined

  onNuxtReady(async () => {
    const { Realtime } = await import('ably')
    const ably = new Realtime({ key: config.key })
    const channelName = config.channel || SKEW_DEFAULT_CHANNEL
    const eventName = config.event || SKEW_MESSAGE_TYPE.VERSION

    const channel = ably.channels.get(channelName)
    await channel.subscribe(eventName, (message) => {
      const data: SkewUpdateMessage = typeof message.data === 'string' ? JSON.parse(message.data) : message.data
      onMessage(data)
    })

    cleanup = () => {
      channel.unsubscribe()
      ably.close()
    }
  })

  return () => cleanup?.()
})
