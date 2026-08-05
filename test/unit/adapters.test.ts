import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { publishSkewUpdate } from '../../src/runtime/adapters'
import { ablyAdapter } from '../../src/runtime/adapters/ably'
import { pusherAdapter } from '../../src/runtime/adapters/pusher'
import { isSkewAdapter } from '../../src/utils'

const { mockPublish, MockRest, MockRealtime } = vi.hoisted(() => {
  const mockPublish = vi.fn()
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
  }
  return { mockPublish, MockRest, MockRealtime }
})
vi.mock('ably', () => ({
  Rest: MockRest,
  Realtime: MockRealtime,
}))

// Mock window for browser-side adapter tests
const mockWindow = {} as any
beforeEach(() => {
  ;(globalThis as any).window = mockWindow
  mockPublish.mockReset()
})
afterEach(() => {
  delete (globalThis as any).window
})

describe('adapters', () => {
  describe('post-deploy publishing', () => {
    it('publishes only after an explicit call with valid config', async () => {
      const adapter = pusherAdapter({ key: 'key', appId: 'app', secret: 'secret', cluster: 'us2' })
      const broadcast = vi.spyOn(adapter, 'broadcast').mockResolvedValue()

      await expect(publishSkewUpdate(adapter, 'build-123')).resolves.toEqual({ _tag: 'ok' })
      expect(broadcast).toHaveBeenCalledWith(adapter.config, 'build-123')
    })

    it('returns a config error without broadcasting', async () => {
      const adapter = pusherAdapter({ key: '', appId: '', secret: '', cluster: '' })
      const broadcast = vi.spyOn(adapter, 'broadcast').mockResolvedValue()

      await expect(publishSkewUpdate(adapter, 'build-123')).resolves.toMatchObject({ _tag: 'invalid-config' })
      expect(broadcast).not.toHaveBeenCalled()
    })
  })

  describe('isSkewAdapter', () => {
    it('should return true for valid adapter', () => {
      expect(isSkewAdapter(pusherAdapter({ key: 'key', appId: 'app', secret: 'secret' }))).toBe(true)
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

    it('should return false for an object without the adapter contract', () => {
      expect(isSkewAdapter({ _tag: 'SkewAdapter', name: 'test' })).toBe(false)
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

    it('only exposes subscribe credentials to the client', () => {
      const adapter = pusherAdapter(config)

      expect(adapter.toPublicConfig(config)).toEqual({
        key: 'test-key',
        cluster: 'us2',
      })
      expect(adapter.toPublicConfig(config)).not.toHaveProperty('appId')
      expect(adapter.toPublicConfig(config)).not.toHaveProperty('secret')
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

    it('never exposes the API key to the client', () => {
      const adapter = ablyAdapter(config)

      expect(adapter.toPublicConfig(config)).toEqual({
        authUrl: '/api/ably-token',
      })
      expect(adapter.toPublicConfig(config)).not.toHaveProperty('key')
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
