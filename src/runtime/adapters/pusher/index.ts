import type { SkewAdapterFactory } from '../types'
import type { PusherAdapterConfig } from './types'
import { defineAdapter } from '../types'
import { broadcast } from './node'
import { pusherConfigSchema } from './types'

export type { PusherAdapterConfig } from './types'
export { pusherConfigSchema } from './types'

export const pusherAdapter: SkewAdapterFactory<PusherAdapterConfig> = defineAdapter({
  name: 'pusher',
  schema: pusherConfigSchema,
  clientModule: 'nuxt-skew-protection/adapters/pusher/web',
  dependencies: ['pusher-js'],
  toPublicConfig: ({ key, cluster, channel, event }) => ({
    key,
    cluster,
    ...(channel ? { channel } : {}),
    ...(event ? { event } : {}),
  }),
  broadcast,
})
