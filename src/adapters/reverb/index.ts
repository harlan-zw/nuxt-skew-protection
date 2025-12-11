import { defineAdapter } from '../types'
import { reverbConfigSchema } from './types'

export type { ReverbAdapterConfig } from './types'
export { reverbConfigSchema } from './types'

export const reverbAdapter = defineAdapter({
  name: 'reverb',
  schema: reverbConfigSchema,
})
