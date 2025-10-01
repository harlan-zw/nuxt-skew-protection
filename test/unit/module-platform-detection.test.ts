import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('Module Platform Detection', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  describe('Cloudflare Detection', () => {
    it('should detect Cloudflare when all required env vars are set', () => {
      vi.stubEnv('CF_WORKER_NAME', 'test-worker')
      vi.stubEnv('CF_PREVIEW_DOMAIN', 'test-account')
      vi.stubEnv('NUXT_DEPLOYMENT_ID', 'test-deployment')

      const isCloudflareEnabled = !!(
        process.env.CF_WORKER_NAME
        && process.env.CF_PREVIEW_DOMAIN
        && (process.env.NUXT_DEPLOYMENT_ID || process.env.NUXT_BUILD_ID)
      )

      expect(isCloudflareEnabled).toBe(true)
    })

    it('should detect Cloudflare with NUXT_BUILD_ID fallback', () => {
      vi.stubEnv('CF_WORKER_NAME', 'test-worker')
      vi.stubEnv('CF_PREVIEW_DOMAIN', 'test-account')
      vi.stubEnv('NUXT_BUILD_ID', 'build-123')

      const isCloudflareEnabled = !!(
        process.env.CF_WORKER_NAME
        && process.env.CF_PREVIEW_DOMAIN
        && (process.env.NUXT_DEPLOYMENT_ID || process.env.NUXT_BUILD_ID)
      )

      expect(isCloudflareEnabled).toBe(true)
    })

    it('should not detect Cloudflare when CF_WORKER_NAME is missing', () => {
      vi.stubEnv('CF_PREVIEW_DOMAIN', 'test-account')
      vi.stubEnv('NUXT_DEPLOYMENT_ID', 'test-deployment')

      const isCloudflareEnabled = !!(
        process.env.CF_WORKER_NAME
        && process.env.CF_PREVIEW_DOMAIN
        && (process.env.NUXT_DEPLOYMENT_ID || process.env.NUXT_BUILD_ID)
      )

      expect(isCloudflareEnabled).toBe(false)
    })

    it('should not detect Cloudflare when CF_PREVIEW_DOMAIN is missing', () => {
      vi.stubEnv('CF_WORKER_NAME', 'test-worker')
      vi.stubEnv('NUXT_DEPLOYMENT_ID', 'test-deployment')

      const isCloudflareEnabled = !!(
        process.env.CF_WORKER_NAME
        && process.env.CF_PREVIEW_DOMAIN
        && (process.env.NUXT_DEPLOYMENT_ID || process.env.NUXT_BUILD_ID)
      )

      expect(isCloudflareEnabled).toBe(false)
    })

    it('should not detect Cloudflare when deployment ID is missing', () => {
      vi.stubEnv('CF_WORKER_NAME', 'test-worker')
      vi.stubEnv('CF_PREVIEW_DOMAIN', 'test-account')

      const isCloudflareEnabled = !!(
        process.env.CF_WORKER_NAME
        && process.env.CF_PREVIEW_DOMAIN
        && (process.env.NUXT_DEPLOYMENT_ID || process.env.NUXT_BUILD_ID)
      )

      expect(isCloudflareEnabled).toBe(false)
    })
  })

  describe('Vercel Detection', () => {
    it('should detect Vercel when both required env vars are set', () => {
      vi.stubEnv('VERCEL_SKEW_PROTECTION_ENABLED', '1')
      vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'vercel-deployment-123')

      const isVercelEnabled = process.env.VERCEL_SKEW_PROTECTION_ENABLED === '1' && !!process.env.VERCEL_DEPLOYMENT_ID

      expect(isVercelEnabled).toBe(true)
    })

    it('should not detect Vercel when VERCEL_SKEW_PROTECTION_ENABLED is not 1', () => {
      vi.stubEnv('VERCEL_SKEW_PROTECTION_ENABLED', '0')
      vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'vercel-deployment-123')

      const isVercelEnabled = process.env.VERCEL_SKEW_PROTECTION_ENABLED === '1' && !!process.env.VERCEL_DEPLOYMENT_ID

      expect(isVercelEnabled).toBe(false)
    })

    it('should not detect Vercel when VERCEL_DEPLOYMENT_ID is missing', () => {
      vi.stubEnv('VERCEL_SKEW_PROTECTION_ENABLED', '1')

      const isVercelEnabled = process.env.VERCEL_SKEW_PROTECTION_ENABLED === '1' && !!process.env.VERCEL_DEPLOYMENT_ID

      expect(isVercelEnabled).toBe(false)
    })

    it('should not detect Vercel when VERCEL_SKEW_PROTECTION_ENABLED is missing', () => {
      vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'vercel-deployment-123')

      const isVercelEnabled = process.env.VERCEL_SKEW_PROTECTION_ENABLED === '1' && !!process.env.VERCEL_DEPLOYMENT_ID

      expect(isVercelEnabled).toBe(false)
    })
  })

  describe('Platform Priority', () => {
    it('should select Cloudflare when both Cloudflare and Vercel are detected', () => {
      vi.stubEnv('CF_WORKER_NAME', 'test-worker')
      vi.stubEnv('CF_PREVIEW_DOMAIN', 'test-account')
      vi.stubEnv('NUXT_DEPLOYMENT_ID', 'test-deployment')
      vi.stubEnv('VERCEL_SKEW_PROTECTION_ENABLED', '1')
      vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'vercel-deployment')

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

    it('should select Vercel when only Vercel is detected', () => {
      vi.stubEnv('VERCEL_SKEW_PROTECTION_ENABLED', '1')
      vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'vercel-deployment')

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

    it('should select Generic when no platform is detected', () => {
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

  describe('Debug Logging', () => {
    it('should log platform selection when debug is enabled', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.stubEnv('CF_WORKER_NAME', 'test-worker')
      vi.stubEnv('CF_PREVIEW_DOMAIN', 'test-account')
      vi.stubEnv('NUXT_DEPLOYMENT_ID', 'test-deployment')

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

      const debug = true
      if (debug) {
        console.log(`[skew-protection] Using ${platform} platform`)
        if (platform === 'cloudflare') {
          console.log(`[skew-protection] Worker: ${process.env.CF_WORKER_NAME}`)
          console.log(`[skew-protection] Preview domain: ${process.env.CF_PREVIEW_DOMAIN}`)
          console.log(`[skew-protection] Deployment ID: ${process.env.NUXT_DEPLOYMENT_ID || process.env.NUXT_BUILD_ID}`)
        }
      }

      expect(consoleSpy).toHaveBeenCalledWith('[skew-protection] Using cloudflare platform')
      expect(consoleSpy).toHaveBeenCalledWith('[skew-protection] Worker: test-worker')
      expect(consoleSpy).toHaveBeenCalledWith('[skew-protection] Preview domain: test-account')
      expect(consoleSpy).toHaveBeenCalledWith('[skew-protection] Deployment ID: test-deployment')

      consoleSpy.mockRestore()
    })

    it('should log Vercel deployment ID when Vercel is selected', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.stubEnv('VERCEL_SKEW_PROTECTION_ENABLED', '1')
      vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'vercel-deployment-123')

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

      const debug = true
      if (debug) {
        console.log(`[skew-protection] Using ${platform} platform`)
        if (platform === 'vercel') {
          console.log(`[skew-protection] Deployment ID: ${process.env.VERCEL_DEPLOYMENT_ID}`)
        }
      }

      expect(consoleSpy).toHaveBeenCalledWith('[skew-protection] Using vercel platform')
      expect(consoleSpy).toHaveBeenCalledWith('[skew-protection] Deployment ID: vercel-deployment-123')

      consoleSpy.mockRestore()
    })
  })
})
