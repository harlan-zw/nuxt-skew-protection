import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Module from '../../../src/module'
import { ablyAdapter } from '../../../src/runtime/adapters/ably'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineNuxtConfig({
  modules: [Module],

  skewProtection: {
    debug: true,
    updateStrategy: ablyAdapter({
      key: process.env.ABLY_KEY!,
      authUrl: '/api/ably-token',
      channel: 'my-channel',
      event: 'my-event',
    }),
  },
})
