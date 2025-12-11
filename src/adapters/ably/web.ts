import type { AblyAdapterConfig } from './types'
import { logger } from '../logger'
import { defineWebSubscribe } from '../types'

export const subscribe = defineWebSubscribe<AblyAdapterConfig>((config, onMessage) => {
  const Echo = (window as any).Echo
  if (!Echo) {
    logger.error('[Skew:Ably] Laravel Echo not found. Install laravel-echo and pusher-js.')
    return () => {}
  }

  const channelName = config.channel || 'skew-protection'
  const eventName = config.event || 'VersionUpdated'

  const channel = Echo.channel(channelName)
  channel.listen(`.${eventName}`, (e: { version: string }) => {
    onMessage({ version: e.version })
  })

  return () => Echo.leave(channelName)
})
