import type { SkewAdapterFactory } from '../types'
import type { PusherAdapterConfig } from './types'
import { defineAdapter } from '../types'
import { pusherConfigSchema } from './types'

export type { PusherAdapterConfig } from './types'
export { pusherConfigSchema } from './types'

export const pusherAdapter: SkewAdapterFactory<PusherAdapterConfig> = defineAdapter({
  name: 'pusher',
  schema: pusherConfigSchema,
})
