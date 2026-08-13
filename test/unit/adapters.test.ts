import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ablyAdapter } from '../../src/runtime/adapters/ably'
import { pusherAdapter } from '../../src/runtime/adapters/pusher'
import { isSkewAdapter } from '../../src/utils'

// Mock Ably SDK
const mockPublish = vi.fn()
const mockRealtimeOptions = vi.fn()
class MockRest {
  channels = {
    get: () => ({ publish: mockPublish }),
  }
}
class MockRealtime {
  channels = {
    get: () => ({
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    }),
  }

  connection = { on: vi.fn() }
  close = vi.fn()

  constructor(options: unknown) {
    mockRealtimeOptions(options)
  }
}

vi.mock('ably', () => ({
  Rest: MockRest,
  Realtime: MockRealtime,
}))

vi.mock('nuxt/app', () => ({
  onNuxtReady: (callback: () => void) => callback(),
}))

// Mock window for browser-side adapter tests
const mockWindow = {} as any
beforeEach(() => {
  ;(globalThis as any).window = mockWindow
  mockPublish.mockReset()
  mockRealtimeOptions.mockReset()
})
afterEach(() => {
  delete (globalThis as any).window
})

describe('adapters', () => {
  describe('isSkewAdapter', () => {
    it('should return true for valid adapter', () => {
      const adapter = {
        name: 'test',
        toPublicConfig: () => ({}),
        subscribe: () => () => {},
        broadcast: async () => {},
      }
      expect(isSkewAdapter(adapter)).toBe(true)
    })

    it('should return false for null', () => {
      expect(isSkewAdapter(null)).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isSkewAdapter(undefined)).toBe(false)
    })

    it('should return false for string', () => {
      expect(isSkewAdapter('polling')).toBe(false)
    })

    it('should return false for object missing name', () => {
      const adapter = {
        subscribe: () => () => {},
        broadcast: async () => {},
      }
      expect(isSkewAdapter(adapter)).toBe(false)
    })

    it('should return false for object missing subscribe', () => {
      const adapter = {
        name: 'test',
        broadcast: async () => {},
      }
      expect(isSkewAdapter(adapter)).toBe(false)
    })

    it('should return false for object missing broadcast', () => {
      const adapter = {
        name: 'test',
        subscribe: () => () => {},
      }
      expect(isSkewAdapter(adapter)).toBe(false)
    })

    it('should return false for object missing public config mapping', () => {
      const adapter = {
        name: 'test',
        subscribe: () => () => {},
        broadcast: async () => {},
      }
      expect(isSkewAdapter(adapter)).toBe(false)
    })

    it('should return false for object with non-function subscribe', () => {
      const adapter = {
        name: 'test',
        subscribe: 'not a function',
        broadcast: async () => {},
      }
      expect(isSkewAdapter(adapter)).toBe(false)
    })

    it('should return false for object with non-function broadcast', () => {
      const adapter = {
        name: 'test',
        subscribe: () => () => {},
        broadcast: 'not a function',
      }
      expect(isSkewAdapter(adapter)).toBe(false)
    })
  })

  describe('pusherAdapter', () => {
    const config = {
      key: 'test-key',
      appId: 'test-app-id',
      secret: 'test-secret',
      cluster: 'us2',
    }

    it('should create valid adapter', () => {
      const adapter = pusherAdapter(config)
      expect(isSkewAdapter(adapter)).toBe(true)
      expect(adapter.name).toBe('pusher')
    })

    it('should use custom channel when provided', () => {
      const customConfig = { ...config, channel: 'my-channel' }
      const adapter = pusherAdapter(customConfig)
      expect(adapter.name).toBe('pusher')
    })

    it('only exposes subscription credentials to the browser', () => {
      const adapter = pusherAdapter({ ...config, channel: 'updates', event: 'release' })

      expect(adapter.toPublicConfig(adapter.config)).toEqual({
        key: 'test-key',
        cluster: 'us2',
        channel: 'updates',
        event: 'release',
      })
    })
  })

  describe('ablyAdapter', () => {
    const config = {
      key: 'appId.keyId:keySecret',
      authUrl: '/api/ably-token',
    }

    it('should create valid adapter', () => {
      const adapter = ablyAdapter(config)
      expect(isSkewAdapter(adapter)).toBe(true)
      expect(adapter.name).toBe('ably')
    })

    it('should use custom channel when provided', () => {
      const customConfig = { ...config, channel: 'my-channel' }
      const adapter = ablyAdapter(customConfig)
      expect(adapter.name).toBe('ably')
    })

    it('only exposes token authentication to the browser', () => {
      const adapter = ablyAdapter({ ...config, clientId: 'browser', channel: 'updates', event: 'release' })

      expect(adapter.toPublicConfig(adapter.config)).toEqual({
        authUrl: '/api/ably-token',
        clientId: 'browser',
        channel: 'updates',
        event: 'release',
      })
    })

    it('uses token authentication for browser subscriptions', async () => {
      const { subscribe } = await import('../../src/runtime/adapters/ably/web')

      subscribe({ authUrl: '/api/ably-token', clientId: 'browser' }, vi.fn())

      await vi.waitFor(() => {
        expect(mockRealtimeOptions).toHaveBeenCalledWith({
          authUrl: '/api/ably-token',
          clientId: 'browser',
        })
      })
    })

    it('broadcast should call Ably SDK', async () => {
      const { broadcast: ablyBroadcast } = await import('../../src/runtime/adapters/ably/node')
      await ablyBroadcast(config, 'test-version-123')

      expect(mockPublish).toHaveBeenCalledWith('version', { version: 'test-version-123' })
    })

    it('broadcast should throw on SDK error', async () => {
      mockPublish.mockRejectedValueOnce(new Error('SDK error'))
      const { broadcast: ablyBroadcast } = await import('../../src/runtime/adapters/ably/node')

      await expect(ablyBroadcast(config, 'test-version')).rejects.toThrow('SDK error')
    })
  })
})
