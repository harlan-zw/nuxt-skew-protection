import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineAdapter } from '../../src/runtime/adapters'
import { ablyAdapter, parseAblyConfig } from '../../src/runtime/adapters/ably'
import { parsePusherConfig, pusherAdapter } from '../../src/runtime/adapters/pusher'
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
    const valid = {
      name: 'test',
      web: '~/adapter/web',
      parseConfig: () => ({ _tag: 'Ok', config: {} }),
      toPublicConfig: () => ({}),
      broadcast: async () => {},
    }

    it('accepts a complete adapter', () => {
      expect(isSkewAdapter(valid)).toBe(true)
    })

    it.each([null, undefined, 'polling'])('rejects %s', (value) => {
      expect(isSkewAdapter(value)).toBe(false)
    })

    it.each(['name', 'web', 'parseConfig', 'toPublicConfig', 'broadcast'])('rejects an adapter without %s', (key) => {
      const { [key as keyof typeof valid]: _, ...adapter } = valid
      expect(isSkewAdapter(adapter)).toBe(false)
    })

    it('rejects a broadcast that is not a function', () => {
      expect(isSkewAdapter({ ...valid, broadcast: 'nope' })).toBe(false)
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

describe('adapter config parsing', () => {
  const pusher = { key: 'k', cluster: 'us2', appId: 'a', secret: 's' }
  const ably = { key: 'app.key:secret', authUrl: '/api/ably-token' }

  it('accepts a valid Pusher config and drops unknown keys', () => {
    expect(parsePusherConfig({ ...pusher, channel: 'c', event: 'e', extra: true })).toEqual({
      _tag: 'Ok',
      config: { ...pusher, channel: 'c', event: 'e' },
    })
  })

  it('accepts a valid Ably config without optional fields', () => {
    expect(parseAblyConfig(ably)).toEqual({ _tag: 'Ok', config: ably })
  })

  it.each([null, undefined, 'pusher', 42, ['key']])('rejects a Pusher config that is %j', (input) => {
    expect(parsePusherConfig(input)).toEqual({ _tag: 'Err', issues: ['config: expected an object'] })
  })

  it('reports every missing or empty Pusher field', () => {
    expect(parsePusherConfig({ key: '', cluster: 'us2', appId: 1 })).toEqual({
      _tag: 'Err',
      issues: [
        'key: Pusher key is required',
        'appId: Pusher appId is required',
        'secret: Pusher secret is required',
      ],
    })
  })

  it('rejects optional Ably fields that are not strings', () => {
    expect(parseAblyConfig({ ...ably, clientId: 7, channel: null, event: {} })).toEqual({
      _tag: 'Err',
      issues: ['clientId: expected a string', 'channel: expected a string', 'event: expected a string'],
    })
  })

  it('fails the adapter factory parse on a malformed config', () => {
    const adapter = ablyAdapter({ key: 'app.key:secret' } as any)
    expect(adapter.parseConfig(adapter.config)).toEqual({ _tag: 'Err', issues: ['authUrl: Ably authUrl is required'] })
  })
})

describe('defineAdapter with a Standard Schema', () => {
  const fileAdapter = defineAdapter({
    name: 'file',
    schema: z.object({ url: z.string().min(1) }),
    web: '~/adapter/web',
    toPublicConfig: ({ url }) => ({ url }),
    broadcast: async () => {},
  })

  it('accepts a config the schema accepts', () => {
    expect(fileAdapter({ url: 'wss://x' }).parseConfig({ url: 'wss://x' })).toEqual({ _tag: 'Ok', config: { url: 'wss://x' } })
  })

  it('maps schema issues to path-prefixed messages', () => {
    const result = fileAdapter({ url: '' }).parseConfig({ url: '' })
    expect(result._tag).toBe('Err')
    expect(result._tag === 'Err' && result.issues).toEqual([expect.stringMatching(/^url: /)])
  })

  it('rejects a schema that validates asynchronously', () => {
    const asyncAdapter = defineAdapter<{ url: string }, { url: string }>({
      name: 'async',
      schema: { '~standard': { version: 1, vendor: 'test', validate: async value => ({ value: value as { url: string } }) } },
      web: '~/adapter/web',
      toPublicConfig: ({ url }) => ({ url }),
      broadcast: async () => {},
    })
    expect(asyncAdapter({ url: 'x' }).parseConfig({ url: 'x' })).toEqual({
      _tag: 'Err',
      issues: ['config: async schemas are not supported, use a synchronous schema'],
    })
  })
})
