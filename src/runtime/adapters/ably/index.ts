import type { SkewAdapterFactory } from '../types'
import type { AblyAdapterConfig, AblyClientConfig } from './types'
import { defineAdapter } from '../types'
import { ablyConfigSchema } from './types'

export type { AblyAdapterConfig } from './types'
export { ablyConfigSchema } from './types'

export const ablyAdapter: SkewAdapterFactory<AblyAdapterConfig, AblyClientConfig> = defineAdapter({
  name: 'ably',
  schema: ablyConfigSchema,
  toPublicConfig: ({ authUrl, clientId, channel, event }) => ({
    authUrl,
    ...(clientId ? { clientId } : {}),
    ...(channel ? { channel } : {}),
    ...(event ? { event } : {}),
  }),
})
