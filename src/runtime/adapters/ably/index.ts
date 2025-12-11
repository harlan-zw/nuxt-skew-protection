import { defineAdapter } from '../types'
import { ablyConfigSchema } from './types'

export type { AblyAdapterConfig } from './types'
export { ablyConfigSchema } from './types'

export const ablyAdapter = defineAdapter({
  name: 'ably',
  schema: ablyConfigSchema,
})
