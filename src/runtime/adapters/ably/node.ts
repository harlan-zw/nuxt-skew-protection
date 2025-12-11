import type { AblyAdapterConfig } from './types'
import { Rest } from 'ably'
import { defineNodeBroadcast } from '../types'

export const broadcast = defineNodeBroadcast<AblyAdapterConfig>(async (config, version) => {
  const ably = new Rest({ key: config.key })

  const channelName = config.channel || 'skew-protection'
  const eventName = config.event || 'VersionUpdated'

  const channel = ably.channels.get(channelName)
  await channel.publish(eventName, { version })
})
