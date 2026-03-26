import type { SkewAdapterFactory } from '../types'
import type { AblyAdapterConfig } from './types'
import { defineAdapter } from '../types'
import { ablyConfigSchema } from './types'

export type { AblyAdapterConfig } from './types'
export { ablyConfigSchema } from './types'

export const ablyAdapter: SkewAdapterFactory<AblyAdapterConfig> = defineAdapter({
  name: 'ably',
  schema: ablyConfigSchema,
})
