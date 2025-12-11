import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ablyAdapter } from '../../../src/adapters/ably'
import Module from '../../../src/module'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineNuxtConfig({
  modules: [Module],

  skewProtection: {
    debug: true,
    updateStrategy: ablyAdapter({
      key: process.env.ABLY_KEY!,
      channel: 'my-channel',
      event: 'my-event',
    }),
  },
})
