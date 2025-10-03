import type { NuxtSkewProtectionRuntimeConfig } from '~/src/runtime/types'
import {
  addComponent,
  addImports,
  addPlugin,
  addServerHandler,
  addTypeTemplate,
  createResolver,
  defineNuxtModule,
} from '@nuxt/kit'
import { relative, resolve } from 'pathe'
import { logger } from './logger'
import { configureSkewProtectionStorage } from './utils/storage'
import { createAssetManager, generateCloudflareManifest } from './utils/version-manager'

export interface ModuleOptions {
  /**
   * Storage configuration for versioned assets
   */
  storage?: (Record<string, any> & {
    driver: string
  })
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
   * Controls Nuxt's native polling of builds/latest.json
   * When SSE is enabled, this is increased to 1 hour as SSE handles real-time updates
   * @default 600000 (10 minutes) without SSE, 3600000 (1h) with SSE
   */
  checkOutdatedBuildInterval?: number | false
  /**
   * Enable Server-Sent Events for real-time version update notifications
   * When enabled, reduces Nuxt's polling frequency and uses SSE for instant updates
   * Only works on platforms with persistent connections (Node.js, Bun, Deno)
   * Auto-disabled on Cloudflare Workers
   * @default false
   */
  sse?: boolean
  /**
   * Enable Cloudflare Durable Objects for real-time version update notifications
   * When enabled, reduces Nuxt's polling frequency and uses WebSocket connections via Durable Objects
   * Only works on Cloudflare Workers with Durable Objects enabled
   * Requires wrangler.toml configuration with durable_objects bindings
   * @default false
   */
  durableObjects?: boolean
  /**
   * Cookie name for storing deployment version
   * @default '__nkpv'
   */
  cookieName?: string

  enabled: boolean
  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean
}

export interface ModulePublicRuntimeConfig {
  skewProtection: NuxtSkewProtectionRuntimeConfig
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-skew-protection',
    compatibility: {
      nuxt: '>=4.0.0',
    },
    configKey: 'skewProtection',
  },
  defaults: {
    retentionDays: 30,
    maxNumberOfVersions: 10,
    checkOutdatedBuildInterval: 600000, // 10 minutes
    sse: false,
    durableObjects: false,
    cookieName: '__nkpv',
    debug: false,
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    logger.level = (options.debug || nuxt.options.debug) ? 4 : 3
    if (options.enabled === false) {
      logger.debug('The module is disabled, skipping setup.')
      return
    }
    // Check for CDN URL configuration - incompatible with this module
    if (nuxt.options.app.cdnURL || process.env.NUXT_APP_CDN_URL) {
      throw new Error(
        '[skew-protection] This module is incompatible with cdnURL configuration.\n'
        + 'The module requires serving versioned assets from the origin server,\n'
        + 'which conflicts with CDN-based asset delivery where assets are served from a different domain.',
      )
    }

    // Detect platform at build time
    const nitroPreset = nuxt.options.nitro?.preset || ''
    const isCloudflare = nitroPreset.includes('cloudflare')
    const isVercel = nitroPreset.includes('vercel') || process.env.VERCEL_SKEW_PROTECTION_ENABLED === '1'

    const platform = isCloudflare ? 'cloudflare' : isVercel ? 'vercel' : 'node'

    // only node needs specific storage handling vercdel & cloudflare have their own mechanisms
    if (platform === 'node') {
      if (!options.storage) {
        options.storage = {
          driver: 'fs',
          base: 'node_modules/.cache/nuxt/skew-protection',
        }
        // log warning that it may not be suitable for production
        logger.warn(
          '[skew-protection] No storage driver configured, defaulting to local filesystem storage.\n'
          + 'This may not be suitable for production environments.\n'
          + 'Please configure a persistent storage solution (e.g., S3, Redis) in the module options.',
        )
      }
      configureSkewProtectionStorage(options.storage)

      // Mount storage for runtime access
      nuxt.options.nitro.storage = nuxt.options.nitro.storage || {}
      nuxt.options.nitro.storage['skew-protection'] = options.storage
    }

    // Debug logging
    if (options.debug) {
      logger.warn(`Platform: ${platform}`)
      logger.warn(`Storage: ${options.storage?.driver || 'none'}`)
    }

    // Platform-specific middleware
    const platformHandlers: Record<string, string> = {
      cloudflare: './runtime/server/middleware/cloudflare-skew.ts',
      vercel: './runtime/server/middleware/vercel-skew.ts',
    }

    if (platformHandlers[platform]) {
      addServerHandler({
        route: '/**',
        handler: resolver.resolve(platformHandlers[platform]),
      })
    }

    // Storage-based middleware (for node/vercel platforms)
    if (platform !== 'cloudflare') {
      const middlewares = [
        './runtime/server/middleware/skew-document.ts',
        './runtime/server/middleware/skew-api.ts',
        './runtime/server/middleware/skew-assets.ts',
      ]

      for (const middleware of middlewares) {
        addServerHandler({
          handler: resolver.resolve(middleware),
          middleware: true,
        })
      }
    }

    // Ensure app manifest is enabled for build checking
    nuxt.options.experimental = nuxt.options.experimental || {}
    if (options.checkOutdatedBuildInterval !== false) {
      nuxt.options.experimental.appManifest = true
      if (typeof options.checkOutdatedBuildInterval === 'number') {
        nuxt.options.experimental.checkOutdatedBuildInterval = options.checkOutdatedBuildInterval
      }
    }

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

    // Add TypeScript types
    addTypeTemplate({
      filename: 'types/nuxt-skew-protection.d.ts',
      getContents: ({ nuxt }) => {
        const typesPath = relative(
          resolve(nuxt.options.rootDir, nuxt.options.buildDir, 'types'),
          resolver.resolve('./runtime/app/composables/useSkewProtection'),
        )
        return `// Generated by nuxt-skew-protection
import type { SkewProtectionPlugin } from '${typesPath}'

declare module '#app' {
  interface NuxtAppManifestMeta {
    skewProtection?: {
      versions?: Record<string, {
        timestamp: string
        expires: string
        assets: string[]
        deletedChunks?: string[]
      }>
      deploymentMapping?: Record<string, string>
    }
  }
}

declare module 'nuxt/app' {
  interface NuxtAppManifestMeta {
    skewProtection?: {
      versions?: Record<string, {
        timestamp: string
        expires: string
        assets: string[]
        deletedChunks?: string[]
      }>
      deploymentMapping?: Record<string, string>
    }
  }
}

export {}
`
      },
    }, {
      nuxt: true,
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
        filePath: resolver.resolve(`./runtime/app/components/SkewNotification/${name}.vue`),
      })
    }

    // Add service worker as public asset
    nuxt.options.nitro.publicAssets = nuxt.options.nitro.publicAssets || []
    nuxt.options.nitro.publicAssets.push({
      dir: resolver.resolve('./assets'),
      maxAge: 0, // Service workers should not be cached
    })

    // Add service worker plugin
    addPlugin({
      src: resolver.resolve('./runtime/app/plugins/service-worker.client.ts'),
      mode: 'client',
    })

    // add useSkewProtection composable import
    addImports({
      name: 'useSkewProtection',
      from: resolver.resolve('./runtime/app/composables/useSkewProtection'),
    })

    // cookie as well
    addImports({
      name: 'useSkewProtectionCookie',
      from: resolver.resolve('./runtime/app/composables/useSkewProtectionCookie'),
    })

    // Add build hooks for asset versioning
    nuxt.hook('nitro:build:public-assets', async (nitro) => {
      const buildId = nuxt.options.runtimeConfig.app.buildId ||= nuxt.options.buildId
      const outputDir = nitro.options.output.dir

      // Cloudflare: generate asset manifest
      if (platform === 'cloudflare') {
        const deploymentId = process.env.NUXT_DEPLOYMENT_ID || buildId
        const buildAssetsDir = nuxt.options.app.buildAssetsDir

        await generateCloudflareManifest(deploymentId, buildId, outputDir, buildAssetsDir, { debug: options.debug })
          .catch((error) => {
            logger.error('Error generating Cloudflare manifest:', error)
          })
        return
      }

      // Storage-based versioning (node/vercel platforms)
      if (!options.storage)
        return

      const assetManager = createAssetManager(options)

      // Check for deployment ID collision
      const isUsed = await assetManager.isDeploymentIdUsed(buildId).catch((error) => {
        logger.error('Error checking deployment ID:', error)
        process.exit(1)
      })

      if (isUsed) {
        logger.error(`Deployment ID collision detected: "${buildId}" has been used previously.`)
        logger.error('Please update your build configuration to generate a new unique deployment ID.')
        process.exit(1)
      }

      // Get list of assets from build
      const assets = await assetManager.getAssetsFromBuild(buildId, outputDir).catch((error) => {
        logger.error('Error getting assets from build:', error)
        process.exit(1)
      })

      // Update versions manifest
      const { isExistingVersion } = await assetManager.updateVersionsManifest(buildId, assets).catch((error) => {
        logger.error('Error updating versions manifest:', error)
        process.exit(1)
      })

      // Store assets in configured storage
      await assetManager.storeAssetsInStorage(buildId, outputDir, assets).catch((error) => {
        logger.error('Error storing assets in storage:', error)
        process.exit(1)
      })

      // Update deployment mapping
      const existingVersions = await assetManager.listExistingVersions().catch((error) => {
        logger.error('Error listing existing versions:', error)
        process.exit(1)
      })
      await assetManager.updateDeploymentMapping(buildId, existingVersions).catch((error) => {
        logger.error('Error updating deployment mapping:', error)
        process.exit(1)
      })

      // Count versions (excluding current)
      const versionCount = existingVersions.filter(v => v.id !== buildId).length

      // For static/prerendered builds: restore old versioned assets into public directory
      if (versionCount > 0) {
        logger.log(`Restoring build files from the last ${versionCount} release${versionCount > 1 ? 's' : ''}...`)
      }

      await assetManager.restoreOldAssetsToPublic(buildId, outputDir, assets, isExistingVersion).catch((error) => {
        logger.error('Error restoring old assets:', error)
        process.exit(1)
      })

      // Augment Nuxt build metadata files with skew protection data
      await assetManager.augmentBuildMetadata(buildId, outputDir).catch((error) => {
        logger.error('Error augmenting build metadata:', error)
        process.exit(1)
      })

      // Clean up expired versions
      await assetManager.cleanupExpiredVersions(outputDir).catch((error) => {
        logger.error('Error cleaning up expired versions:', error)
        process.exit(1)
      })
    })

    // Configure Nuxt's native polling interval
    // This controls how often Nuxt checks builds/latest.json
    if (options.checkOutdatedBuildInterval !== false) {
      nuxt.options.experimental = nuxt.options.experimental || {}
      nuxt.options.experimental.checkOutdatedBuildInterval = options.checkOutdatedBuildInterval

      if (options.debug) {
        logger.info(`Nuxt polling interval set to ${options.checkOutdatedBuildInterval}ms`)
      }
    }

    // Add SSE route for real-time updates (if enabled and platform supports it)
    if (options.sse) {
      if (platform === 'cloudflare') {
        logger.warn('SSE not supported on Cloudflare Workers (no persistent connections), falling back to native polling only')
        options.sse = false
      }
      else {
        addServerHandler({
          route: '/_skew/updates',
          handler: resolver.resolve('./runtime/server/routes/_skew/updates.ts'),
        })

        if (options.sse) {
          // Add SSE plugin for client
          addPlugin(resolver.resolve('./runtime/app/plugins/sse-version-updates.client.ts'))
        }

        // Increase Nuxt's polling interval since SSE provides real-time updates
        if (options.checkOutdatedBuildInterval === 600000) {
          nuxt.options.experimental.checkOutdatedBuildInterval = 3600000 // 1 hour
          if (options.debug) {
            logger.info('SSE enabled, increasing Nuxt polling interval to 1 hour (SSE handles real-time updates)')
          }
        }
      }
    }

    // Add Durable Objects WebSocket route for real-time updates (if enabled and on Cloudflare)
    if (options.durableObjects) {
      if (platform !== 'cloudflare') {
        logger.warn('Durable Objects only supported on Cloudflare Workers, falling back to native polling only')
        options.durableObjects = false
      }
      else {
        // Add WebSocket route
        addServerHandler({
          route: '/_skew/ws',
          handler: resolver.resolve('./runtime/server/routes/_skew/ws.ts'),
        })

        // Add WebSocket plugin for client
        addPlugin(resolver.resolve('./runtime/app/plugins/websocket-version-updates.client.ts'))

        // Increase Nuxt's polling interval since Durable Objects provides real-time updates
        if (options.checkOutdatedBuildInterval === 600000) {
          nuxt.options.experimental.checkOutdatedBuildInterval = 3600000 // 1 hour
          if (options.debug) {
            logger.info('Durable Objects enabled, increasing Nuxt polling interval to 1 hour (Durable Objects handles real-time updates)')
          }
        }

        if (options.debug) {
          logger.info('Durable Objects WebSocket enabled for real-time version updates')
          logger.info('Make sure to configure Durable Objects binding in wrangler.toml:')
          logger.info('  [[durable_objects.bindings]]')
          logger.info('  name = "VERSION_UPDATES"')
          logger.info('  class_name = "VersionUpdatesDO"')
        }
      }
    }

    // Add runtime config for client access to module options
    nuxt.options.runtimeConfig.public = nuxt.options.runtimeConfig.public || {}
    nuxt.options.runtimeConfig.public.skewProtection = {
      sse: options.sse,
      durableObjects: options.durableObjects,
      cookieName: options.cookieName,
      debug: options.debug,
    }
  },
})
