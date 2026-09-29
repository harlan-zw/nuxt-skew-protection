import type { SkewAdapterFactory } from '../types'
import type { PusherAdapterConfig, PusherClientConfig } from './types'
import { fileURLToPath } from 'node:url'
import { defineAdapter } from '../types'
import { pusherConfigSchema } from './types'

export type { PusherAdapterConfig } from './types'
export { pusherConfigSchema } from './types'

export const pusherAdapter: SkewAdapterFactory<PusherAdapterConfig, PusherClientConfig> = defineAdapter({
  name: 'pusher',
  web: fileURLToPath(new URL('./web', import.meta.url)),
  dependencies: ['pusher-js'],
  // Lazy, so loading nuxt.config does not load the server SDK.
  broadcast: (config, version) => import('./node').then(m => m.broadcast(config, version)),
  schema: pusherConfigSchema,
  toPublicConfig: ({ key, cluster, channel, event }) => ({
    key,
    cluster,
    ...(channel ? { channel } : {}),
    ...(event ? { event } : {}),
  }),
})
