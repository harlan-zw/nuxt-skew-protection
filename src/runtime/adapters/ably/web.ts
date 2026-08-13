import type { AblyClientConfig } from './types'
import { onNuxtReady } from 'nuxt/app'
import { SKEW_DEFAULT_CHANNEL, SKEW_MESSAGE_TYPE } from '../../const'
import { defineWebSubscribe } from '../types'

export const subscribe = defineWebSubscribe<AblyClientConfig>((config, onMessage) => {
  let cleanup: (() => void) | undefined

  onNuxtReady(async () => {
    const { Realtime } = await import('ably')
    const ably = new Realtime({ authUrl: config.authUrl, clientId: config.clientId })
    const channelName = config.channel || SKEW_DEFAULT_CHANNEL
    const eventName = config.event || SKEW_MESSAGE_TYPE.VERSION

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
