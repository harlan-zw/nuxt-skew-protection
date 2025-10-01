import {
  addComponent,
  addPlugin,
  addServerHandler,
  createResolver,
  defineNuxtModule,
} from '@nuxt/kit'
import { createAssetManager } from './utils/asset-manager'
import { getDeploymentMapping } from './utils/deployment-mapping'

export interface ModuleOptions {
  /**
   * Storage configuration for versioned assets
   */
  storage?: any
  /**
   * How long to retain old versions (in days)
   * @default 7
   */
  retentionDays?: number
  /**
   * Maximum number of versions to retain
   * @default 10
   */
  maxNumberOfVersions?: number
  /**
   * Check interval for version updates (in ms)
   * When WebSocket is enabled, this is increased to 1 hour as WebSocket handles real-time updates
   * @default 30000 (30s) without WebSocket, 3600000 (1h) with WebSocket
   */
  checkOutdatedBuildInterval?: number | false
  /**
   * Notification strategy when version mismatch is detected
   * @default 'modal'
   */
  notificationStrategy?: 'modal' | 'toast' | 'redirect' | 'silent'
  /**
   * Enable WebSocket for real-time version update notifications
   * When enabled, reduces polling frequency and uses WebSocket for instant updates
   * @default false
   */
  enableWebSocket?: boolean
  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-skew-protection',
    compatibility: {
      nuxt: '>=3.6.1',
    },
    configKey: 'skewProtection',
  },
  defaults: {
    retentionDays: 7,
    maxNumberOfVersions: 10,
    checkOutdatedBuildInterval: 30000,
    notificationStrategy: 'modal',
    enableWebSocket: false,
    debug: false,
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)

    // Detect platform at build time (priority: Cloudflare > Vercel > Generic)
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

    if (options.debug) {
      console.log(`[skew-protection] Using ${platform} platform`)
      if (platform === 'cloudflare') {
        console.log(`[skew-protection] Worker: ${process.env.CF_WORKER_NAME}`)
        console.log(`[skew-protection] Preview domain: ${process.env.CF_PREVIEW_DOMAIN}`)
        console.log(`[skew-protection] Deployment ID: ${process.env.NUXT_DEPLOYMENT_ID || process.env.NUXT_BUILD_ID}`)
      }
      else if (platform === 'vercel') {
        console.log(`[skew-protection] Deployment ID: ${process.env.VERCEL_DEPLOYMENT_ID}`)
      }
    }

    // Add platform-specific middleware handlers
    if (platform === 'cloudflare') {
      // Add early middleware for Cloudflare request routing (runs before all other handlers)
      addServerHandler({
        route: '/**',
        handler: resolver.resolve('./runtime/server/middleware/cloudflare-skew.ts'),
      })
    }
    else if (platform === 'vercel') {
      // Add middleware for Vercel's skew protection pattern
      addServerHandler({
        route: '/**',
        handler: resolver.resolve('./runtime/server/middleware/vercel-skew.ts'),
      })
    }

    // Ensure app manifest is enabled for build checking
    nuxt.options.experimental = nuxt.options.experimental || {}
    if (options.checkOutdatedBuildInterval !== false) {
      nuxt.options.experimental.appManifest = true
      if (typeof options.checkOutdatedBuildInterval === 'number') {
        nuxt.options.experimental.checkOutdatedBuildInterval = options.checkOutdatedBuildInterval
      }
    }

    // Add global middleware for skew detection (split by responsibility)
    addServerHandler({
      handler: resolver.resolve('./runtime/server/middleware/skew-document.ts'),
      middleware: true,
    })

    addServerHandler({
      handler: resolver.resolve('./runtime/server/middleware/skew-api.ts'),
      middleware: true,
    })

    addServerHandler({
      handler: resolver.resolve('./runtime/server/middleware/skew-assets.ts'),
      middleware: true,
    })

    // Add route for client version checking
    addServerHandler({
      route: '/_skew/status',
      handler: resolver.resolve('./runtime/server/routes/_skew/status.ts'),
    })

    // Add route for debugging
    addServerHandler({
      route: '/_skew/debug',
      handler: resolver.resolve('./runtime/server/routes/_skew/debug.ts'),
    })

    // Add client plugin for version tracking
    addPlugin({
      src: resolver.resolve('./runtime/app/plugins/version-tracker.client.ts'),
      mode: 'client',
    })

    // Add SkewNotification UI components
    const componentNames = [
      'SkewNotificationRoot',
      'SkewNotificationOverlay',
      'SkewNotificationContent',
      'SkewNotificationHeader',
      'SkewNotificationTitle',
      'SkewNotificationDescription',
      'SkewNotificationActions',
      'SkewNotificationReloadButton',
      'SkewNotificationDismissButton',
    ]

    for (const name of componentNames) {
      addComponent({
        name,
        filePath: resolver.resolve(`./runtime/app/components/ui/SkewNotification/${name}.vue`),
      })
    }

    // Add build hooks for asset versioning
    nuxt.hook('build:done', async () => {
      const buildId = nuxt.options.runtimeConfig.app.buildId ||= nuxt.options.buildId
      if (options.debug) {
        console.log(`[skew-protection] Build completed with ID: ${buildId}`)
      }

      // Only proceed if storage is configured
      if (!options.storage) {
        if (options.debug) {
          console.log(`[skew-protection] No storage configured, skipping asset versioning`)
        }
        return
      }

      const assetManager = createAssetManager(options)
      const outputDir = nuxt.options.nitro.output?.dir || nuxt.options.buildDir

      // Check for deployment ID collision
      const deploymentMapping = getDeploymentMapping()
      const isUsed = await deploymentMapping.isDeploymentIdUsed(buildId).catch((error) => {
        console.error('[skew-protection] Error checking deployment ID:', error)
        process.exit(1)
      })

      if (isUsed) {
        console.error(`[skew-protection] Deployment ID collision detected: "${buildId}" has been used previously.`)
        console.error('[skew-protection] Please update your build configuration to generate a new unique deployment ID.')
        process.exit(1)
      }

      if (options.debug) {
        console.log(`[skew-protection] Deployment ID "${buildId}" is unique, proceeding with build.`)
      }

      // Copy assets to versioned directory
      const assets = await assetManager.copyAssetsToVersionedDirectory(buildId, outputDir).catch((error) => {
        console.error('[skew-protection] Error copying assets:', error)
        process.exit(1)
      })

      // Update versions manifest
      await assetManager.updateVersionsManifest(buildId, assets).catch((error) => {
        console.error('[skew-protection] Error updating versions manifest:', error)
        process.exit(1)
      })

      // Store assets in configured storage
      await assetManager.storeAssetsInStorage(buildId, outputDir, assets).catch((error) => {
        console.error('[skew-protection] Error storing assets in storage:', error)
        process.exit(1)
      })

      // Update deployment mapping
      const existingVersions = await assetManager.listExistingVersions().catch((error) => {
        console.error('[skew-protection] Error listing existing versions:', error)
        process.exit(1)
      })
      await deploymentMapping.updateMapping(buildId, existingVersions, options.maxNumberOfVersions).catch((error) => {
        console.error('[skew-protection] Error updating deployment mapping:', error)
        process.exit(1)
      })

      if (options.debug) {
        console.log(`[skew-protection] Updated deployment mapping for "${buildId}"`)
      }

      // Clean up expired versions
      await assetManager.cleanupExpiredVersions(outputDir).catch((error) => {
        console.error('[skew-protection] Error cleaning up expired versions:', error)
        process.exit(1)
      })
    })

    // Adjust polling interval if WebSocket is enabled
    if (options.enableWebSocket && options.checkOutdatedBuildInterval === 30000) {
      // If using default polling interval, increase it to 1 hour when WebSocket is enabled
      options.checkOutdatedBuildInterval = 3600000 // 1 hour
      if (options.debug) {
        console.log('[skew-protection] WebSocket enabled, increasing polling interval to 1 hour')
      }
    }

    // Add WebSocket route if enabled
    if (options.enableWebSocket) {
      addServerHandler({
        route: '/_skew/ws',
        handler: resolver.resolve('./runtime/server/routes/_skew/ws.ts'),
      })

      // Add Nitro plugin for WebSocket broadcasts
      nuxt.options.nitro.plugins = nuxt.options.nitro.plugins || []
      nuxt.options.nitro.plugins.push(resolver.resolve('./runtime/server/plugins/ws-broadcaster.ts'))
    }

    // Add runtime config for client access to module options
    nuxt.options.runtimeConfig.public = nuxt.options.runtimeConfig.public || {}
    nuxt.options.runtimeConfig.public.skewProtection = {
      notificationStrategy: options.notificationStrategy,
      enableWebSocket: options.enableWebSocket,
      debug: options.debug,
    }
  },
})
