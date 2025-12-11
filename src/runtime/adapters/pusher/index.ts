import { defineAdapter } from '../types'
import { pusherConfigSchema } from './types'

export type { PusherAdapterConfig } from './types'
export { pusherConfigSchema } from './types'

export const pusherAdapter = defineAdapter({
  name: 'pusher',
  schema: pusherConfigSchema,
})
