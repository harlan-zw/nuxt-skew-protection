import type { AblyAdapterConfig } from './types'
import { Rest } from 'ably'
import { SKEW_DEFAULT_CHANNEL, SKEW_MESSAGE_TYPE } from '../../const'
import { prepareSkewUpdate } from '../payload'
import { defineNodeBroadcast } from '../types'

export const broadcast = defineNodeBroadcast<AblyAdapterConfig>(async (config, update) => {
  const ably = new Rest({ key: config.key })

  const channelName = config.channel || SKEW_DEFAULT_CHANNEL
  const eventName = config.event || SKEW_MESSAGE_TYPE.VERSION
  const prepared = prepareSkewUpdate('ably', update)

  const channel = ably.channels.get(channelName)
  await channel.publish(eventName, prepared.update)

  return prepared.result
})
