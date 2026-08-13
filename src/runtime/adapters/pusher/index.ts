import type { SkewAdapterFactory } from '../types'
import type { PusherAdapterConfig, PusherClientConfig } from './types'
import { defineAdapter } from '../types'
import { pusherConfigSchema } from './types'

export type { PusherAdapterConfig } from './types'
export { pusherConfigSchema } from './types'

export const pusherAdapter: SkewAdapterFactory<PusherAdapterConfig, PusherClientConfig> = defineAdapter({
  name: 'pusher',
  schema: pusherConfigSchema,
  toPublicConfig: ({ key, cluster, channel, event }) => ({
    key,
    cluster,
    ...(channel ? { channel } : {}),
    ...(event ? { event } : {}),
  }),
})
