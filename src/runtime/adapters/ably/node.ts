import type { AblyAdapterConfig } from './types'
import { Rest } from 'ably'
import { SKEW_DEFAULT_CHANNEL, SKEW_MESSAGE_TYPE } from '../../const'
import { defineNodeBroadcast } from '../types'

export const broadcast = defineNodeBroadcast<AblyAdapterConfig>(async (config, version) => {
  const ably = new Rest({ key: config.key })

  const channelName = config.channel || SKEW_DEFAULT_CHANNEL
  const eventName = config.event || SKEW_MESSAGE_TYPE.VERSION

  const channel = ably.channels.get(channelName)
  await channel.publish(eventName, { version })
})
