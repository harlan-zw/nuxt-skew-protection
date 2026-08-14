import { defineAdapter } from 'nuxt-skew-protection/adapters'
import { z } from 'zod'

export const myAdapter = defineAdapter({
  name: 'my-adapter',
  schema: z.object({ endpoint: z.string().url() }),
  clientModule: './my-adapter.client',
  toPublicConfig: config => ({ endpoint: config.endpoint }),
  async broadcast() {},
})
