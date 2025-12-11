import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ablyAdapter } from '../../src/adapters/ably'
import { broadcast as ablyBroadcast } from '../../src/adapters/ably/node'
import { pusherAdapter } from '../../src/adapters/pusher'
import { isSkewAdapter } from '../../src/adapters/types'

// Mock window for browser-side adapter tests
const mockWindow = {} as any
beforeEach(() => {
  ;(globalThis as any).window = mockWindow
})
afterEach(() => {
  delete (globalThis as any).window
})

describe('adapters', () => {
  describe('isSkewAdapter', () => {
    it('should return true for valid adapter', () => {
      const adapter = {
        name: 'test',
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
  })

  describe('ablyAdapter', () => {
    const config = {
      key: 'appId.keyId:keySecret',
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

    it('broadcast should call Ably REST API', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))

      await ablyBroadcast(config, 'test-version-123')

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://rest.ably.io/channels/skew-protection/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': expect.stringMatching(/^Basic /),
          }),
        }),
      )

      fetchSpy.mockRestore()
    })

    it('broadcast should throw on API error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Unauthorized', { status: 401 }))

      await expect(ablyBroadcast(config, 'test-version')).rejects.toThrow('Ably broadcast failed: 401')

      fetchSpy.mockRestore()
    })
  })
})
