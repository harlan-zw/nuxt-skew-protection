import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Module from '../../../src/module'
import { pusherAdapter } from '../../../src/runtime/adapters/pusher'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineNuxtConfig({
  modules: [Module],

  skewProtection: {
    debug: true,
    updateStrategy: pusherAdapter({
      key: process.env.PUSHER_KEY!,
      appId: process.env.PUSHER_APP_ID!,
      secret: process.env.PUSHER_SECRET!,
      cluster: process.env.PUSHER_CLUSTER || 'ap4',
      channel: 'my-channel',
      event: 'my-event',
    }),
  },
})
