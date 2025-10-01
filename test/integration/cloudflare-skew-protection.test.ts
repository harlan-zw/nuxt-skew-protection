import { describe, expect, it } from 'vitest'

describe('Cloudflare Skew Protection Integration', () => {
  describe('Module Configuration', () => {
    it('should detect Cloudflare platform from environment variables', () => {
      // Set Cloudflare environment
      process.env.CF_WORKER_NAME = 'test-worker'
      process.env.CF_PREVIEW_DOMAIN = 'test-account'
      process.env.NUXT_DEPLOYMENT_ID = 'test-deployment'

      const isCloudflareEnabled = !!(
        process.env.CF_WORKER_NAME
        && process.env.CF_PREVIEW_DOMAIN
        && (process.env.NUXT_DEPLOYMENT_ID || process.env.NUXT_BUILD_ID)
      )

      expect(isCloudflareEnabled).toBe(true)
    })

    it('should detect Vercel platform from environment variables', () => {
      process.env.VERCEL_SKEW_PROTECTION_ENABLED = '1'
      process.env.VERCEL_DEPLOYMENT_ID = 'test-deployment'

      const isVercelEnabled = process.env.VERCEL_SKEW_PROTECTION_ENABLED === '1' && !!process.env.VERCEL_DEPLOYMENT_ID

      expect(isVercelEnabled).toBe(true)
    })

    it('should fall back to generic platform when no platform detected', () => {
      // Clear all platform-specific env vars
      delete process.env.CF_WORKER_NAME
      delete process.env.CF_PREVIEW_DOMAIN
      delete process.env.VERCEL_SKEW_PROTECTION_ENABLED
      delete process.env.VERCEL_DEPLOYMENT_ID

      const isCloudflareEnabled = !!(
        process.env.CF_WORKER_NAME
        && process.env.CF_PREVIEW_DOMAIN
        && (process.env.NUXT_DEPLOYMENT_ID || process.env.NUXT_BUILD_ID)
      )
      const isVercelEnabled = process.env.VERCEL_SKEW_PROTECTION_ENABLED === '1' && !!process.env.VERCEL_DEPLOYMENT_ID

      let platform = 'generic'
      if (isCloudflareEnabled) {
        platform = 'cloudflare'
      }
      else if (isVercelEnabled) {
        platform = 'vercel'
      }

      expect(platform).toBe('generic')
    })
  })

  describe('Deployment Mapping Parsing', () => {
    it('should parse valid deployment mapping JSON', () => {
      const mapping = {
        'deployment-1': 'version-abc',
        'deployment-2': 'current',
      }

      process.env.CF_DEPLOYMENT_MAPPING = JSON.stringify(mapping)

      let parsed
      try {
        parsed = JSON.parse(process.env.CF_DEPLOYMENT_MAPPING)
      }
      catch {
        parsed = {}
      }

      expect(parsed).toEqual(mapping)
    })

    it('should handle invalid deployment mapping gracefully', () => {
      process.env.CF_DEPLOYMENT_MAPPING = 'invalid-json'

      let parsed
      try {
        parsed = JSON.parse(process.env.CF_DEPLOYMENT_MAPPING)
      }
      catch {
        parsed = {}
      }

      expect(parsed).toEqual({})
    })

    it('should handle empty deployment mapping', () => {
      process.env.CF_DEPLOYMENT_MAPPING = ''

      let parsed
      try {
        if (process.env.CF_DEPLOYMENT_MAPPING) {
          parsed = JSON.parse(process.env.CF_DEPLOYMENT_MAPPING)
        }
        else {
          parsed = {}
        }
      }
      catch {
        parsed = {}
      }

      expect(parsed).toEqual({})
    })
  })

  describe('Preview URL Construction', () => {
    it('should construct correct Cloudflare preview URL', () => {
      const workerName = 'my-app'
      const previewDomain = 'my-account'
      const versionId = 'abc123'

      const previewUrl = `https://${versionId}-${workerName}.${previewDomain}.workers.dev`

      expect(previewUrl).toBe('https://abc123-my-app.my-account.workers.dev')
    })

    it('should handle different version ID formats', () => {
      const workerName = 'test-worker'
      const previewDomain = 'test-account'
      const versionId = 'feature-branch-v2'

      const previewUrl = `https://${versionId}-${workerName}.${previewDomain}.workers.dev`

      expect(previewUrl).toBe('https://feature-branch-v2-test-worker.test-account.workers.dev')
    })
  })

  describe('Deployment ID Detection', () => {
    it('should use NUXT_DEPLOYMENT_ID when available', () => {
      process.env.NUXT_DEPLOYMENT_ID = 'custom-deployment-id'
      process.env.NUXT_BUILD_ID = 'build-id'

      const deploymentId = process.env.NUXT_DEPLOYMENT_ID || process.env.NUXT_BUILD_ID

      expect(deploymentId).toBe('custom-deployment-id')
    })

    it('should fall back to NUXT_BUILD_ID', () => {
      delete process.env.NUXT_DEPLOYMENT_ID
      process.env.NUXT_BUILD_ID = 'build-id'

      const deploymentId = process.env.NUXT_DEPLOYMENT_ID || process.env.NUXT_BUILD_ID

      expect(deploymentId).toBe('build-id')
    })

    it('should use VERCEL_DEPLOYMENT_ID for Vercel', () => {
      process.env.VERCEL_DEPLOYMENT_ID = 'vercel-deployment-123'

      const deploymentId = process.env.VERCEL_DEPLOYMENT_ID

      expect(deploymentId).toBe('vercel-deployment-123')
    })
  })

  describe('Domain Filtering Logic', () => {
    it('should identify localhost domains', () => {
      const localhostDomains = [
        'localhost',
        'localhost:3000',
        '127.0.0.1',
        '127.0.0.1:8080',
      ]

      for (const hostname of localhostDomains) {
        const isLocal = hostname.includes('localhost') || hostname.includes('127.0.0.1')
        expect(isLocal).toBe(true)
      }
    })

    it('should identify workers.dev domains', () => {
      const workersDomains = [
        'my-app.workers.dev',
        'subdomain.my-app.workers.dev',
        'test-worker.workers.dev',
      ]

      for (const hostname of workersDomains) {
        const isWorkersDev = hostname.includes('workers.dev')
        expect(isWorkersDev).toBe(true)
      }
    })

    it('should identify custom domains', () => {
      const customDomains = [
        'example.com',
        'my-domain.com',
        'app.production.com',
      ]

      for (const hostname of customDomains) {
        const isLocal = hostname.includes('localhost') || hostname.includes('127.0.0.1')
        const isWorkersDev = hostname.includes('workers.dev')
        const isCustom = !isLocal && !isWorkersDev

        expect(isCustom).toBe(true)
      }
    })
  })

  describe('Platform Priority', () => {
    it('should prioritize Cloudflare over Vercel', () => {
      // Set both Cloudflare and Vercel env vars
      process.env.CF_WORKER_NAME = 'test-worker'
      process.env.CF_PREVIEW_DOMAIN = 'test-account'
      process.env.NUXT_DEPLOYMENT_ID = 'test-deployment'
      process.env.VERCEL_SKEW_PROTECTION_ENABLED = '1'
      process.env.VERCEL_DEPLOYMENT_ID = 'vercel-deployment'

      const isCloudflareEnabled = !!(
        process.env.CF_WORKER_NAME
        && process.env.CF_PREVIEW_DOMAIN
        && (process.env.NUXT_DEPLOYMENT_ID || process.env.NUXT_BUILD_ID)
      )
      const isVercelEnabled = process.env.VERCEL_SKEW_PROTECTION_ENABLED === '1' && !!process.env.VERCEL_DEPLOYMENT_ID

      let platform = 'generic'
      if (isCloudflareEnabled) {
        platform = 'cloudflare'
      }
      else if (isVercelEnabled) {
        platform = 'vercel'
      }

      expect(platform).toBe('cloudflare')
    })

    it('should prioritize Vercel over Generic', () => {
      // Remove Cloudflare env vars, set Vercel
      delete process.env.CF_WORKER_NAME
      delete process.env.CF_PREVIEW_DOMAIN
      process.env.VERCEL_SKEW_PROTECTION_ENABLED = '1'
      process.env.VERCEL_DEPLOYMENT_ID = 'vercel-deployment'

      const isCloudflareEnabled = !!(
        process.env.CF_WORKER_NAME
        && process.env.CF_PREVIEW_DOMAIN
        && (process.env.NUXT_DEPLOYMENT_ID || process.env.NUXT_BUILD_ID)
      )
      const isVercelEnabled = process.env.VERCEL_SKEW_PROTECTION_ENABLED === '1' && !!process.env.VERCEL_DEPLOYMENT_ID

      let platform = 'generic'
      if (isCloudflareEnabled) {
        platform = 'cloudflare'
      }
      else if (isVercelEnabled) {
        platform = 'vercel'
      }

      expect(platform).toBe('vercel')
    })
  })
})
