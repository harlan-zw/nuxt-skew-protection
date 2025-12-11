import type { ReverbAdapterConfig } from './types'
import { logger } from '../logger'
import { defineWebSubscribe } from '../types'

export const subscribe = defineWebSubscribe<ReverbAdapterConfig>((config, onMessage) => {
  const Echo = (window as any).Echo
  if (!Echo) {
    logger.error('[Skew:Reverb] Laravel Echo not found. Install laravel-echo and pusher-js.')
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
