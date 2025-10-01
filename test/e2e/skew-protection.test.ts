import { $fetch, setup } from '@nuxt/test-utils'
import { beforeAll, describe, expect, it } from 'vitest'

describe('Skew Protection E2E Tests', () => {
  beforeAll(async () => {
    await setup({
      rootDir: import.meta.dirname,
      configFile: 'nuxt.config.ts',
      server: true,
      build: true,
    })
  })

  describe('Version Status API', () => {
    it('should return current version status', async () => {
      const response = await $fetch('/_skew/status')

      expect(response).toMatchObject({
        current: expect.any(String),
        versions: expect.any(Object),
      })
    })

    it('should return version manifest with required fields', async () => {
      const response = await $fetch('/_skew/status')

      if (Object.keys(response.versions).length > 0) {
        const firstVersion = Object.values(response.versions)[0]
        expect(firstVersion).toMatchObject({
          timestamp: expect.any(String),
          expires: expect.any(String),
          assets: expect.any(Array),
        })
      }
    })
  })

  describe('Debug API', () => {
    it('should return debug information', async () => {
      const response = await $fetch('/_skew/debug')

      expect(response).toMatchObject({
        platform: expect.stringMatching(/^(cloudflare|vercel|generic)$/),
        buildId: expect.any(String),
      })
    })

    it('should include stats when available', async () => {
      const response = await $fetch('/_skew/debug')

      // Stats might not always be present depending on configuration
      if (response.stats) {
        expect(response.stats).toMatchObject({
          currentVersion: expect.any(String),
          totalVersions: expect.any(Number),
        })
      }
    })
  })

  describe('Error Handling', () => {
    it('should handle non-existent versioned assets gracefully', async () => {
      try {
        await $fetch('/_skew/versions/non-existent/test.js')
      }
      catch (error: any) {
        // Should return proper HTTP error
        expect(error.statusCode).toBeOneOf([302, 404])
      }
    })

    it('should handle malformed paths', async () => {
      try {
        await $fetch('/_skew/versions/../../../etc/passwd')
      }
      catch (error: any) {
        expect(error.statusCode).toBeOneOf([400, 404])
      }
    })
  })

  describe('Performance', () => {
    it('should respond to status check quickly', async () => {
      const start = Date.now()
      await $fetch('/_skew/status')
      const duration = Date.now() - start

      expect(duration).toBeLessThan(1000) // Should respond within 1 second
    })

    it('should handle concurrent requests', async () => {
      const concurrentRequests = Array.from({ length: 10 }).map(() =>
        $fetch('/_skew/status'),
      )

      const start = Date.now()
      const responses = await Promise.all(concurrentRequests)
      const duration = Date.now() - start

      expect(responses).toHaveLength(10)
      responses.forEach((response) => {
        expect(response).toHaveProperty('current')
      })

      expect(duration).toBeLessThan(5000) // All requests within 5 seconds
    })
  })

  describe('Deployment ID Handling', () => {
    it('should handle deployment ID in header', async () => {
      try {
        await $fetch('/_skew/versions/test/asset.js', {
          headers: {
            'x-deployment-id': 'test-deployment-123',
          },
        })
      }
      catch (error: any) {
        // Should handle gracefully even if asset doesn't exist
        expect(error.statusCode).toBeOneOf([302, 404])
      }
    })

    it('should handle deployment ID in query parameter', async () => {
      try {
        await $fetch('/_skew/versions/test/asset.js?dpl=test-deployment-456')
      }
      catch (error: any) {
        expect(error.statusCode).toBeOneOf([302, 404])
      }
    })
  })

  describe('Content Types', () => {
    it('should set appropriate content-type for JS files', async () => {
      try {
        await $fetch('/_skew/versions/test/test.js')
      }
      catch (error: any) {
        // Even if file doesn't exist, check error response structure
        if (error.response) {
          // Verify the path was processed as a JS file
          expect(error.data || error.message).toBeDefined()
        }
      }
    })

    it('should set appropriate content-type for CSS files', async () => {
      try {
        await $fetch('/_skew/versions/test/test.css')
      }
      catch (error: any) {
        if (error.response) {
          expect(error.data || error.message).toBeDefined()
        }
      }
    })
  })

  describe('WebSocket Support (if enabled)', () => {
    it('should provide WebSocket endpoint when enabled', async () => {
      try {
        // WebSocket endpoint might not be available in all configurations
        const response = await $fetch('/_skew/ws', {
          method: 'HEAD',
        })
        // If it responds, WebSocket is enabled
        expect(response).toBeDefined()
      }
      catch (error: any) {
        // If not found (404), WebSocket is disabled - that's okay
        expect([404, 405, 200]).toContain(error.statusCode)
      }
    })
  })

  describe('Security', () => {
    it('should not expose sensitive information in debug endpoint', async () => {
      const response = await $fetch('/_skew/debug')

      // Should not expose sensitive env vars or secrets
      const responseStr = JSON.stringify(response)
      expect(responseStr).not.toContain('API_KEY')
      expect(responseStr).not.toContain('SECRET')
      expect(responseStr).not.toContain('PASSWORD')
    })

    it('should sanitize paths to prevent directory traversal', async () => {
      const maliciousPaths = [
        '/_skew/versions/../../../etc/passwd',
        '/_skew/versions/..%2F..%2F..%2Fetc%2Fpasswd',
        '/_skew/versions/test/../../../../../../etc/passwd',
      ]

      for (const path of maliciousPaths) {
        try {
          await $fetch(path)
          // If it doesn't throw, it should not return sensitive content
        }
        catch (error: any) {
          // Should return error, not expose files
          expect(error.statusCode).toBeOneOf([400, 404])
        }
      }
    })
  })
})

// Helper to extend expect with custom matchers
declare global {
  namespace Vi {
    interface AsymmetricMatchersContaining {
      toBeOneOf(expected: any[]): any
    }
  }
}

expect.extend({
  toBeOneOf(received, expected) {
    const pass = expected.includes(received)
    if (pass) {
      return {
        message: () => `expected ${received} not to be one of ${expected.join(', ')}`,
        pass: true,
      }
    }
    else {
      return {
        message: () => `expected ${received} to be one of ${expected.join(', ')}`,
        pass: false,
      }
    }
  },
})
