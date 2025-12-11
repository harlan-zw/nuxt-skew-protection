import { describe, expect, it } from 'vitest'
import { broadcast } from '../../src/runtime/adapters/pusher/node'

describe.skipIf(!process.env.PUSHER_KEY)('pusher Adapter Integration', () => {
  const config = {
    key: process.env.PUSHER_KEY!,
    appId: process.env.PUSHER_APP_ID!,
    secret: process.env.PUSHER_SECRET!,
    cluster: process.env.PUSHER_CLUSTER || 'ap4',
    channel: 'my-channel',
    event: 'my-event',
  }

  it('should broadcast to Pusher API', async () => {
    const version = `test-${Date.now()}`
    await broadcast(config, version)
  })

  it('should fail with invalid credentials', async () => {
    const invalidConfig = { ...config, secret: 'invalid-secret' }
    await expect(broadcast(invalidConfig, 'test')).rejects.toThrow('Pusher broadcast failed')
  })
})
