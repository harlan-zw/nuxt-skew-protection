import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock h3 functions
vi.mock('h3', () => ({
  defineEventHandler: vi.fn(handler => handler),
  getHeader: vi.fn(),
  getQuery: vi.fn(),
  setResponseStatus: vi.fn(),
  setResponseHeaders: vi.fn(),
}))

// Mock fetch globally
global.fetch = vi.fn()

describe('cloudflare Skew Protection Middleware', () => {
  let mockEvent: any

  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()

    // Setup mock event
    mockEvent = {
      node: {
        req: {
          url: '/some-path?param=value',
          method: 'GET',
          headers: {
            'host': 'example.com',
            'user-agent': 'test-agent',
          },
        },
      },
    }

    // Set up Cloudflare environment
    vi.stubEnv('CF_WORKER_NAME', 'test-worker')
    vi.stubEnv('CF_PREVIEW_DOMAIN', 'test-account')
    vi.stubEnv('NUXT_DEPLOYMENT_ID', 'current-deployment')
  })

  describe('platform Detection', () => {
    it('should only activate on Cloudflare environment', async () => {
      const { getHeader, getQuery } = await import('h3')
      vi.mocked(getHeader).mockReturnValue(null)
      vi.mocked(getQuery).mockReturnValue({})

      // Import middleware
      const middleware = await import('../../src/runtime/server/middleware/cloudflare-skew')
      const handler = middleware.default

      const result = await handler(mockEvent)
      expect(result).toBeUndefined() // No action when no deployment ID requested
    })

    it('should skip when not on Cloudflare', async () => {
      // Remove Cloudflare env vars
      vi.unstubAllEnvs()

      const { getHeader, getQuery } = await import('h3')
      vi.mocked(getHeader).mockReturnValue('old-deployment')
      vi.mocked(getQuery).mockReturnValue({})

      const middleware = await import('../../src/runtime/server/middleware/cloudflare-skew')
      const handler = middleware.default

      const result = await handler(mockEvent)
      expect(result).toBeUndefined() // No Cloudflare env = no routing
    })
  })

  describe('domain Filtering', () => {
    it('should skip localhost domain', async () => {
      mockEvent.node.req.headers.host = 'localhost:3000'

      const { getHeader, getQuery } = await import('h3')
      vi.mocked(getHeader).mockReturnValue('old-deployment')
      vi.mocked(getQuery).mockReturnValue({})

      const middleware = await import('../../src/runtime/server/middleware/cloudflare-skew')
      const handler = middleware.default

      const result = await handler(mockEvent)
      expect(result).toBeUndefined()
      expect(fetch).not.toHaveBeenCalled()
    })

    it('should skip workers.dev domain', async () => {
      mockEvent.node.req.headers.host = 'my-app.workers.dev'

      const { getHeader, getQuery } = await import('h3')
      vi.mocked(getHeader).mockReturnValue('old-deployment')
      vi.mocked(getQuery).mockReturnValue({})

      const middleware = await import('../../src/runtime/server/middleware/cloudflare-skew')
      const handler = middleware.default

      const result = await handler(mockEvent)
      expect(result).toBeUndefined()
      expect(fetch).not.toHaveBeenCalled()
    })

    it('should process custom domain', async () => {
      mockEvent.node.req.headers.host = 'example.com'

      const { getHeader, getQuery } = await import('h3')
      vi.mocked(getHeader).mockReturnValue('old-deployment')
      vi.mocked(getQuery).mockReturnValue({})

      process.env.CF_DEPLOYMENT_MAPPING = JSON.stringify({
        'old-deployment': 'version123',
      })

      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        body: 'response',
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as any)

      const middleware = await import('../../src/runtime/server/middleware/cloudflare-skew')
      const handler = middleware.default

      await handler(mockEvent)
      expect(fetch).toHaveBeenCalled()
    })
  })

  describe('deployment ID Detection', () => {
    it('should detect deployment ID from header', async () => {
      const { getHeader, getQuery } = await import('h3')
      vi.mocked(getHeader).mockReturnValue('old-deployment')
      vi.mocked(getQuery).mockReturnValue({})

      process.env.CF_DEPLOYMENT_MAPPING = JSON.stringify({
        'old-deployment': 'version123',
      })

      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        body: 'response',
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as any)

      const middleware = await import('../../src/runtime/server/middleware/cloudflare-skew')
      const handler = middleware.default

      await handler(mockEvent)

      expect(fetch).toHaveBeenCalled()
      const fetchCall = vi.mocked(fetch).mock.calls[0]
      const fetchUrl = fetchCall[0] as string
      // Version ID "version123" split by "-" gives "version123" as first part
      expect(fetchUrl).toContain('version123-test-worker.test-account.workers.dev')
    })

    it('should detect deployment ID from query parameter', async () => {
      const { getHeader } = await import('h3')
      vi.mocked(getHeader).mockReturnValue(null)

      // Update the mock event to include query param in URL
      mockEvent.node.req.url = '/some-path?dpl=old-deployment&param=value'

      process.env.CF_DEPLOYMENT_MAPPING = JSON.stringify({
        'old-deployment': 'version123',
      })

      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        body: 'response',
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as any)

      const middleware = await import('../../src/runtime/server/middleware/cloudflare-skew')
      const handler = middleware.default

      await handler(mockEvent)
      expect(fetch).toHaveBeenCalled()
    })

    it('should skip when no deployment ID provided', async () => {
      const { getHeader, getQuery } = await import('h3')
      vi.mocked(getHeader).mockReturnValue(null)
      vi.mocked(getQuery).mockReturnValue({})

      const middleware = await import('../../src/runtime/server/middleware/cloudflare-skew')
      const handler = middleware.default

      const result = await handler(mockEvent)
      expect(result).toBeUndefined()
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  describe('deployment Mapping Logic', () => {
    it('should skip when requested deployment is current', async () => {
      const { getHeader, getQuery } = await import('h3')
      vi.mocked(getHeader).mockReturnValue('current-deployment')
      vi.mocked(getQuery).mockReturnValue({})

      const middleware = await import('../../src/runtime/server/middleware/cloudflare-skew')
      const handler = middleware.default

      const result = await handler(mockEvent)
      expect(result).toBeUndefined()
      expect(fetch).not.toHaveBeenCalled()
    })

    it('should skip when no deployment mapping set', async () => {
      const { getHeader, getQuery } = await import('h3')
      vi.mocked(getHeader).mockReturnValue('old-deployment')
      vi.mocked(getQuery).mockReturnValue({})

      delete process.env.CF_DEPLOYMENT_MAPPING

      const middleware = await import('../../src/runtime/server/middleware/cloudflare-skew')
      const handler = middleware.default

      const result = await handler(mockEvent)
      expect(result).toBeUndefined()
      expect(fetch).not.toHaveBeenCalled()
    })

    it('should skip when deployment not in mapping', async () => {
      const { getHeader, getQuery } = await import('h3')
      vi.mocked(getHeader).mockReturnValue('unknown-deployment')
      vi.mocked(getQuery).mockReturnValue({})

      process.env.CF_DEPLOYMENT_MAPPING = JSON.stringify({
        'other-deployment': 'version123',
      })

      const middleware = await import('../../src/runtime/server/middleware/cloudflare-skew')
      const handler = middleware.default

      const result = await handler(mockEvent)
      expect(result).toBeUndefined()
      expect(fetch).not.toHaveBeenCalled()
    })

    it('should skip when version is "current"', async () => {
      const { getHeader, getQuery } = await import('h3')
      vi.mocked(getHeader).mockReturnValue('old-deployment')
      vi.mocked(getQuery).mockReturnValue({})

      process.env.CF_DEPLOYMENT_MAPPING = JSON.stringify({
        'old-deployment': 'current',
      })

      const middleware = await import('../../src/runtime/server/middleware/cloudflare-skew')
      const handler = middleware.default

      const result = await handler(mockEvent)
      expect(result).toBeUndefined()
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  describe('request Forwarding', () => {
    it('should forward request to versioned worker', async () => {
      const { getHeader, getQuery, setResponseStatus, setResponseHeaders } = await import('h3')
      vi.mocked(getHeader).mockReturnValue('old-deployment')
      vi.mocked(getQuery).mockReturnValue({})

      process.env.CF_DEPLOYMENT_MAPPING = JSON.stringify({
        'old-deployment': 'version123',
      })

      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'content-type': 'text/html',
          'x-custom-header': 'value',
        }),
        body: 'response body',
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as any)

      const middleware = await import('../../src/runtime/server/middleware/cloudflare-skew')
      const handler = middleware.default

      const result = await handler(mockEvent)

      // Should call fetch with correct URL
      expect(fetch).toHaveBeenCalled()
      const fetchCall = vi.mocked(fetch).mock.calls[0]
      const fetchUrl = fetchCall[0] as string
      const fetchOptions = fetchCall[1] as RequestInit
      expect(fetchUrl).toBe('http://version123-test-worker.test-account.workers.dev/some-path?param=value')
      expect(fetchOptions.method).toBe('GET')

      // Should set response headers and status
      expect(setResponseStatus).toHaveBeenCalledWith(mockEvent, 200, 'OK')
      expect(setResponseHeaders).toHaveBeenCalledWith(mockEvent, {
        'content-type': 'text/html',
        'x-custom-header': 'value',
      })

      // Should return response body
      expect(result).toBeDefined()
    })

    it('should exclude origin header', async () => {
      const { getHeader, getQuery } = await import('h3')
      vi.mocked(getHeader).mockReturnValue('old-deployment')
      vi.mocked(getQuery).mockReturnValue({})

      mockEvent.node.req.headers.origin = 'https://example.com'

      process.env.CF_DEPLOYMENT_MAPPING = JSON.stringify({
        'old-deployment': 'version123',
      })

      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        body: 'response',
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as any)

      const middleware = await import('../../src/runtime/server/middleware/cloudflare-skew')
      const handler = middleware.default

      await handler(mockEvent)

      const fetchCall = vi.mocked(fetch).mock.calls[0]
      const fetchOptions = fetchCall[1] as RequestInit
      const headers = fetchOptions.headers as Headers
      expect(headers.get('origin')).toBeNull()
      expect(headers.get('host')).toBe('example.com')
    })

    it('should handle POST request with body', async () => {
      const { getHeader, getQuery } = await import('h3')
      vi.mocked(getHeader).mockReturnValue('old-deployment')
      vi.mocked(getQuery).mockReturnValue({})

      mockEvent.node.req.method = 'POST'
      mockEvent.node.req.body = 'request body'

      process.env.CF_DEPLOYMENT_MAPPING = JSON.stringify({
        'old-deployment': 'version123',
      })

      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        body: 'response',
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as any)

      const middleware = await import('../../src/runtime/server/middleware/cloudflare-skew')
      const handler = middleware.default

      await handler(mockEvent)

      const fetchCall = vi.mocked(fetch).mock.calls[0]
      const fetchOptions = fetchCall[1] as RequestInit
      expect(fetchOptions.method).toBe('POST')
      expect(fetchOptions.body).toBeDefined()
    })
  })

  describe('error Handling', () => {
    it('should handle fetch errors gracefully', async () => {
      const { getHeader, getQuery } = await import('h3')
      vi.mocked(getHeader).mockReturnValue('old-deployment')
      vi.mocked(getQuery).mockReturnValue({})

      process.env.CF_DEPLOYMENT_MAPPING = JSON.stringify({
        'old-deployment': 'version123',
      })

      vi.mocked(fetch).mockRejectedValue(new Error('Network error'))

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const middleware = await import('../../src/runtime/server/middleware/cloudflare-skew')
      const handler = middleware.default

      const result = await handler(mockEvent)

      expect(consoleSpy).toHaveBeenCalledWith(
        '[skew-protection] Failed to forward request:',
        expect.any(Error),
      )
      expect(result).toBeUndefined()

      consoleSpy.mockRestore()
    })

    it('should handle invalid deployment mapping JSON', async () => {
      const { getHeader, getQuery } = await import('h3')
      vi.mocked(getHeader).mockReturnValue('old-deployment')
      vi.mocked(getQuery).mockReturnValue({})

      process.env.CF_DEPLOYMENT_MAPPING = 'invalid json'

      const middleware = await import('../../src/runtime/server/middleware/cloudflare-skew')
      const handler = middleware.default

      const result = await handler(mockEvent)

      // Should handle gracefully and not crash
      expect(result).toBeUndefined()
      expect(fetch).not.toHaveBeenCalled()
    })
  })
})
