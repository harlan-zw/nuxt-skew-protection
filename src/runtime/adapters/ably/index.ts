import type { SkewAdapterFactory } from '../types'
import type { AblyAdapterConfig, AblyClientConfig } from './types'
import { fileURLToPath } from 'node:url'
import { defineAdapter } from '../types'
import { ablyConfigSchema } from './types'

export type { AblyAdapterConfig } from './types'
export { ablyConfigSchema } from './types'

export const ablyAdapter: SkewAdapterFactory<AblyAdapterConfig, AblyClientConfig> = defineAdapter({
  name: 'ably',
  web: fileURLToPath(new URL('./web', import.meta.url)),
  dependencies: ['ably'],
  // Lazy, so loading nuxt.config does not load the server SDK.
  broadcast: (config, version) => import('./node').then(m => m.broadcast(config, version)),
  schema: ablyConfigSchema,
  toPublicConfig: ({ authUrl, clientId, channel, event }) => ({
    authUrl,
    ...(clientId ? { clientId } : {}),
    ...(channel ? { channel } : {}),
    ...(event ? { event } : {}),
  }),
})
