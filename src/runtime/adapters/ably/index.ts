import type { SkewAdapterFactory } from '../types'
import type { AblyAdapterConfig, AblyClientConfig } from './types'
import { defineAdapter } from '../types'
import { broadcast } from './node'
import { ablyConfigSchema } from './types'

export type { AblyAdapterConfig } from './types'
export { ablyConfigSchema } from './types'

export const ablyAdapter: SkewAdapterFactory<AblyAdapterConfig, AblyClientConfig> = defineAdapter({
  name: 'ably',
  schema: ablyConfigSchema,
  clientModule: 'nuxt-skew-protection/adapters/ably/web',
  dependencies: ['ably'],
  toPublicConfig: ({ authUrl, clientId, channel, event }) => ({
    authUrl,
    ...(clientId ? { clientId } : {}),
    ...(channel ? { channel } : {}),
    ...(event ? { event } : {}),
  }),
  broadcast,
})
