import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { defineAdapter } from '../../../../src/runtime/adapters'

const schema = z.object({
  endpoint: z.string().min(1),
  outFile: z.string().min(1),
})

// A user-land adapter, written the way the external providers docs describe.
export const fileAdapter = defineAdapter({
  name: 'file',
  schema,
  web: fileURLToPath(new URL('./web', import.meta.url)),
  toPublicConfig: ({ endpoint }) => ({ endpoint }),
  broadcast: async (config, version) => {
    writeFileSync(config.outFile, version)
  },
})
