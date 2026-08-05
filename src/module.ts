import type { CookieSerializeOptions } from 'cookie-es'
import type { SkewAdapter } from './runtime/adapters/types'
import type { NuxtSkewProtectionRuntimeConfig } from './runtime/types'
import {
  addComponent,
  addImports,
  addPlugin,
  addServerHandler,
  addTemplate,
  addTypeTemplate,
  createResolver,
  defineNuxtModule,
  hasNuxtModule,
  tryResolveModule,
} from '@nuxt/kit'
import { colors } from 'consola/utils'
import { renderNitroTypeAugmentations, setupNitroRuntimeCompatibility } from 'nuxtseo-shared/kit'
import { readPackageJSON } from 'pkg-types'
import { isStaticPreset, resolveNitroPreset } from './kit'
import { logger } from './logger'
import { resolveBasePath, resolveCookieName } from './resolve-base-path'
import { resolveBuildTimeDriver } from './unstorage/utils'
import { isSkewAdapter } from './utils'
import { createAssetManager } from './utils/version-manager'

export interface ModuleOptions {
  /**
   * Storage configuration for versioned assets
   */
  storage?: (Record<string, any> & {
    driver: string
  })
  /**
   * How long to retain old versions (in days)
   * @default 30
   */
  retentionDays?: number
  /**
   * Maximum number of versions to retain
   * @default 10
   */
  maxNumberOfVersions?: number
  /**
   * Strategy for checking for version updates
   * - 'polling': Nuxt's native polling of builds/latest.json (default)
   * - 'sse': Use Server-Sent Events for real-time updates
   * - 'ws': Use WebSocket (requires cloudflare-durable preset or experimental.websocket)
   * - SkewAdapter: Third-party WebSocket provider (Pusher, Ably)
   * @default Static: 'polling', Node: 'sse', Cloudflare: 'ws'
   */
  updateStrategy?: false | 'polling' | 'sse' | 'ws' | SkewAdapter
  /**
   * Path prefix for the module's runtime endpoints (`/ws`, `/sse`, `/health`,
   * `/route`, `/subscribe-stats`, `/admin/stats`).
   *
   * Defaults to `/__skew`. Set a sub-path when the app is path-routed behind a
   * worker that only owns part of the host (e.g. a Pro dashboard mounted under
   * `/pro/*` on a host shared with a marketing app): use `/pro/__skew` so the
   * websocket/health requests resolve to this worker's deployment instead of
   * leaking to the sibling app that owns the host route.
   * @default '/__skew'
   */
  basePath?: string
  /**
   * Cookie configuration for storing deployment version
   */
  cookie?: false | Omit<CookieSerializeOptions, 'encode'> & {
    /**
     * Cookie name for storing deployment version.
     *
     * Defaults to `__nkpv`, suffixed with the mount point for a path-routed app
     * (e.g. `/pro/*` → `__nkpv_pro`) so apps sharing a host don't clobber each
     * other's cookie. Set this to override the derived name.
     * @default '__nkpv' (or `__nkpv_<mount>` when path-routed)
     */
    name?: string
  }
  /**
   * Bundle old deployment assets to support users on previous versions.
   * When enabled, old build assets are stored and served to users who haven't refreshed.
   * @default true
   */
  bundleAssets?: boolean
  /**
   * Persist release metadata and augment Nuxt build manifests even when asset
   * bytes are retained by the deployment platform.
   * @default true
   */
  trackBuildMetadata?: boolean
  /**
   * Enable or disable the module
   * @default true
   */
  enabled: boolean
  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean
  /**
   * Enable connection tracking to monitor active SSE/WebSocket connections
   * Exposes useActiveConnections() composable with real-time stats
   * @default false
   */
  connectionTracking?: boolean
  /**
   * Track which routes users are currently viewing
   * Requires connectionTracking to be enabled
   * @default false
   */
  routeTracking?: boolean
  /**
   * Track IP addresses of connected users
   * Requires connectionTracking to be enabled
   * Privacy note: IPs are only stored in memory and exposed via stats
   * @default false
   */
  ipTracking?: boolean
  /**
   * How to handle a newly deployed release.
   * - 'prompt': Show notification, let user decide (default)
   * - 'immediate': Reload immediately
   * - 'idle': Reload after five seconds of inactivity or when hidden
   * - false: Disable automatic handling, use hooks for custom logic
   * @default 'prompt'
   */
  reloadStrategy?: 'prompt' | 'immediate' | 'idle' | false
  /**
   * Coordinate version updates across browser tabs via BroadcastChannel.
   * When enabled, a version update detected in one tab notifies all others.
   * @default true
   */
  multiTab?: boolean
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
  moduleDependencies: {
    '@nuxtjs/robots': {
      version: '>=5.6.7',
    },
    'nuxt-site-config': {
      version: '>=4.0',
    },
    'nuxtseo-shared': {
      version: '>=0.8.0',
    },
  },
  defaults: {
    retentionDays: 30,
    maxNumberOfVersions: 10,
    bundleAssets: true,
    trackBuildMetadata: true,
    cookie: {
      // `name` intentionally omitted — derived from the mount point in setup
      // (`resolveCookieName`) so path-routed apps get a distinct cookie. An
      // explicit `cookie.name` overrides it.
      path: '/',
      sameSite: 'lax' as const,
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
    storage: {
      driver: 'fs',
      base: 'node_modules/.cache/nuxt-seo/skew-protection',
    },
    debug: false,
    reloadStrategy: 'prompt',
    multiTab: true,
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const { version } = await readPackageJSON(resolver.resolve('../package.json'))
    logger.level = (options.debug || nuxt.options.debug) ? 4 : 3
    if (options.enabled === false) {
      logger.debug('The module is disabled, skipping setup.')
      return
    }
    if (nuxt.options.experimental.appManifest === false) {
      throw new Error('nuxt-skew-protection requires `experimental.appManifest` because deployment detection uses Nuxt build manifests.')
    }
    const nitroCompatibility = setupNitroRuntimeCompatibility(nuxt)

    // Resolve the endpoint prefix. When `basePath` isn't set explicitly it's
    // auto-detected from the app mount point (absolute `buildAssetsDir` parent,
    // then `app.baseURL`), so a path-routed worker like a `/pro/*` dashboard
    // gets `/pro/__skew` with zero config. See resolveBasePath.
    const basePathExplicit = !!options.basePath
    const basePath = resolveBasePath({ basePath: options.basePath, app: nuxt.options.app })
    options.basePath = basePath
    logger.debug(`Endpoints mounted at ${basePath}/* (${basePathExplicit ? 'explicit' : 'auto-detected'})`)

    // Derive a per-mount cookie name so path-routed apps sharing a host don't
    // clobber each other's version cookie (explicit `cookie.name` wins).
    if (options.cookie !== false) {
      options.cookie = options.cookie || {}
      options.cookie.name = resolveCookieName(options.cookie.name, basePath)
    }

    // v1 migration: accept old config names with deprecation warnings
    const rawOptions = (nuxt.options as any).skewProtection || {}
    if ('bundlePreviousDeploymentChunks' in rawOptions) {
      logger.warn('`bundlePreviousDeploymentChunks` is deprecated, use `bundleAssets` instead. See https://nuxtseo.com/docs/skew-protection/releases/v1')
      if (!('bundleAssets' in rawOptions)) {
        options.bundleAssets = rawOptions.bundlePreviousDeploymentChunks
      }
    }

    nuxt.hooks.hook('nuxt-seo-pro:modules' as any, (modules: any[]) => {
      const mod = modules.find((m: any) => m.name === 'nuxt-skew-protection')
      if (mod) {
        mod.features = {
          updateStrategy: options.updateStrategy || 'polling',
          reloadStrategy: options.reloadStrategy || 'prompt',
          multiTab: options.multiTab !== false,
          connectionTracking: !!options.connectionTracking,
          bundleAssets: options.bundleAssets !== false,
        }
      }
    })
    // Add runtime config for client access to module options
    nuxt.options.runtimeConfig.public = nuxt.options.runtimeConfig.public || {}
    if (options.routeTracking && !options.connectionTracking) {
      logger.warn('`routeTracking` requires `connectionTracking: true`. Route tracking will be disabled.')
    }
    if (options.ipTracking && !options.connectionTracking) {
      logger.warn('`ipTracking` requires `connectionTracking: true`. IP tracking will be disabled.')
    }

    // @ts-expect-error untyped
    nuxt.options.runtimeConfig.public.skewProtection = {
      basePath,
      cookie: options.cookie as Required<NuxtSkewProtectionRuntimeConfig['cookie']>,
      debug: options.debug,
      connectionTracking: options.connectionTracking,
      routeTracking: options.connectionTracking && options.routeTracking,
      ipTracking: options.connectionTracking && options.ipTracking,
      reloadStrategy: options.reloadStrategy ?? 'prompt',
      multiTab: options.multiTab ?? true,
      discoveryURL: undefined,
      updatesEnabled: true,
      updateInterval: 60 * 60 * 1000,
      version,
    } as Required<NuxtSkewProtectionRuntimeConfig>

    // Detect Nitro preset
    const nitroPreset = resolveNitroPreset(nuxt.options.nitro)

    // Detect NuxtHub and guide users on KV configuration
    const isNuxtHub = hasNuxtModule('@nuxthub/core')
    if (isNuxtHub && options.storage?.driver === 'cloudflare-kv-binding' && !options.storage.namespaceId) {
      logger.error('NuxtHub detected with cloudflare-kv-binding driver but no namespaceId configured.')
      logger.info('Learn more: https://nuxtseo.com/docs/skew-protection/guides/cloudflare')
      throw new Error('namespaceId required for cloudflare-kv-binding driver with NuxtHub')
    }

    // Add Nuxt TypeScript types
    addTypeTemplate({
      filename: 'types/nuxt-skew-protection.d.ts',
      getContents: () => `// Generated by nuxt-skew-protection
import type { SkewAdapterConfig, SkewConnection, SkewSSEConfig, SkewWebSocketConfig } from '#skew-protection/app/types'

declare module '#app' {
  interface RuntimeNuxtHooks {
    'skew:message': (message: { type: string, [key: string]: unknown }) => void | Promise<void>
    'skew:ws:config': (config: SkewWebSocketConfig) => void | Promise<void>
    'skew:sse:config': (config: SkewSSEConfig) => void | Promise<void>
    'skew:adapter:config': (config: SkewAdapterConfig) => void | Promise<void>
  }
  interface NuxtApp {
    $skewConnection?: SkewConnection
    _skewStatsSubscribed?: boolean
  }
  interface NuxtAppManifestMeta {
    skewProtection?: {
      versions?: Record<string, {
        timestamp: string
        expires: string
      }>
    }
  }
}

declare module 'nuxt/app' {
  interface RuntimeNuxtHooks {
    'skew:message': (message: { type: string, [key: string]: unknown }) => void | Promise<void>
    'skew:ws:config': (config: SkewWebSocketConfig) => void | Promise<void>
    'skew:sse:config': (config: SkewSSEConfig) => void | Promise<void>
    'skew:adapter:config': (config: SkewAdapterConfig) => void | Promise<void>
  }
  interface NuxtApp {
    $skewConnection?: SkewConnection
    _skewStatsSubscribed?: boolean
  }
  interface NuxtAppManifestMeta {
    skewProtection?: {
      versions?: Record<string, {
        timestamp: string
        expires: string
      }>
    }
  }
}

export type { SkewAdapterConfig, SkewConnection, SkewSSEConfig, SkewWebSocketConfig }
`,
    }, { nuxt: true })

    // Add Nitro TypeScript types (separate for tree-shaking)
    addTypeTemplate({
      filename: 'types/nuxt-skew-protection-nitro.d.ts',
      getContents: () => {
        const nitroTypes = renderNitroTypeAugmentations(nitroCompatibility, {
          eventContext: `/** Client's deployment version from skew protection cookie */
skewVersion?: string`,
          runtimeHooks: `'skew:connection:open': (payload: {
      id: string
      version: string
      route?: string
      ip?: string
      send: (data: unknown) => void
    }) => void
    'skew:connection:route-update': (payload: { id: string, route: string }) => void
    'skew:connection:close': (payload: { id: string }) => void
    /** event is an HTTP event for SSE, or headers for WebSocket connections. */
    'skew:subscribe-stats': (payload: { id: string, event?: ${nitroCompatibility.eventType} | { headers?: Headers } }) => void
    /** event is an HTTP event for SSE, or headers for WebSocket connections. */
    'skew:authorize-stats': (payload: { event?: ${nitroCompatibility.eventType} | { headers?: Headers }, authorize: () => void }) => void
    'skew:stats': (callback: (stats: { total: number, versions: Record<string, number>, routes: Record<string, number> }) => void) => void`,
        })
        return `// Generated by nuxt-skew-protection

${nitroTypes}

export {}
`
      },
    }, { nitro: true })

    addComponent({
      name: 'SkewNotification',
      filePath: resolver.resolve(`./runtime/app/components/SkewNotification.vue`),
    })

    // add useSkewProtection composable import
    addImports({
      name: 'useSkewProtection',
      from: resolver.resolve('./runtime/app/composables/useSkewProtection'),
    })

    // add useActiveConnections composable when connection tracking is enabled
    if (options.connectionTracking) {
      addImports({
        name: 'useActiveConnections',
        from: resolver.resolve('./runtime/app/composables/useActiveConnections'),
      })

      // Add Nitro plugin for connection tracking (tree-shakable)
      nuxt.options.nitro = nuxt.options.nitro || {}
      nuxt.options.nitro.plugins = nuxt.options.nitro.plugins || []
      const connectionTrackingPlugin = nitroPreset === 'cloudflare-durable'
        ? './runtime/server/plugins/connection-tracking-cloudflare-durable'
        : './runtime/server/plugins/connection-tracking'
      nuxt.options.nitro.plugins.push(resolver.resolve(connectionTrackingPlugin))
    }

    // add aliases for nuxt-skew-protection types and server
    nuxt.options.alias['#skew-protection'] = resolver.resolve('./runtime')
    nuxt.options.alias['nuxt-skew-protection/server'] = resolver.resolve('./runtime/server')
    if (options.storage?.driver) {
      // Mount storage for runtime access
      nuxt.options.nitro = nuxt.options.nitro || {}
      nuxt.options.nitro.storage = nuxt.options.nitro.storage || {}
      nuxt.options.nitro.storage['skew-protection'] = options.storage
    }

    // Dev mode: add WS plugin for connectionTracking
    if (nuxt.options.dev && options.connectionTracking) {
      if (nuxt.options.nitro?.experimental?.websocket) {
        addServerHandler({
          route: `${basePath}/ws`,
          handler: resolver.resolve('./runtime/server/routes/__skew/ws'),
        })
        addServerHandler({
          route: `${basePath}/subscribe-stats`,
          method: 'post',
          handler: resolver.resolve('./runtime/server/routes/__skew/subscribe-stats.post'),
        })
        if (options.routeTracking) {
          addServerHandler({
            route: `${basePath}/route`,
            method: 'post',
            handler: resolver.resolve('./runtime/server/routes/__skew/route.post'),
          })
        }
        addPlugin(resolver.resolve('./runtime/app/plugins/check-updates-websocket.client'))
      }
      else {
        logger.warn('connectionTracking in dev mode requires `nitro.experimental.websocket: true`')
      }
    }

    // Multi-tab + auto-reload in dev mode
    if (nuxt.options.dev && (options.multiTab !== false || (options.reloadStrategy && options.reloadStrategy !== 'prompt'))) {
      addPlugin({
        src: resolver.resolve('./runtime/app/plugins/multi-tab.client'),
        mode: 'client',
      })
    }

    // DevTools integration (dev mode only)
    if (nuxt.options.dev) {
      const { setupDevToolsUI } = await import('./build/devtools')
      setupDevToolsUI(resolver.resolve, nuxt)
    }

    // Skip production setup in dev mode
    if (!nuxt.options.dev) {
      const isCloudflareRuntime = nitroPreset?.includes('cloudflare')
      const isVercel = nitroPreset?.includes('vercel') || process.env.VERCEL_SKEW_PROTECTION_ENABLED === '1'
      const isStatic = isStaticPreset(nuxt)

      const isAdapter = isSkewAdapter(options.updateStrategy)
      let resolvedStrategy: false | 'polling' | 'sse' | 'ws' | 'adapter' = 'polling'
      if (isAdapter)
        resolvedStrategy = 'adapter'
      else if (options.updateStrategy === false)
        resolvedStrategy = false
      else if (options.updateStrategy === 'ws')
        resolvedStrategy = 'ws'
      else if (options.updateStrategy === 'sse')
        resolvedStrategy = 'sse'
      else if (!options.updateStrategy)
        resolvedStrategy = isStatic ? 'polling' : isCloudflareRuntime ? 'ws' : 'sse'

      if (isStatic && resolvedStrategy !== false && resolvedStrategy !== 'polling' && resolvedStrategy !== 'adapter') {
        logger.warn(`Strategy "${resolvedStrategy}" requires a server but static generation detected. Falling back to polling.`)
        resolvedStrategy = 'polling'
      }

      nuxt.options.runtimeConfig.public.skewProtection.updatesEnabled = resolvedStrategy !== false
      if (resolvedStrategy === false)
        nuxt.options.experimental.checkOutdatedBuildInterval = false

      if (isVercel) {
        addServerHandler({
          handler: resolver.resolve('./runtime/server/middleware/vercel-skew'),
          middleware: true,
        })
      }

      if (options.cookie !== false) {
        addServerHandler({
          handler: resolver.resolve('./runtime/server/middleware/set-skew-protection-cookie'),
          middleware: true,
        })
      }

      // Health check endpoint
      if (!isStatic) {
        addServerHandler({
          route: `${basePath}/health`,
          method: 'get',
          handler: resolver.resolve('./runtime/server/routes/__skew/health.get'),
        })
      }

      // Admin stats endpoint for nuxtseo.com dashboard (requires connectionTracking)
      if (options.connectionTracking && !isStatic) {
        addServerHandler({
          route: `${basePath}/admin/stats`,
          method: 'get',
          handler: resolver.resolve('./runtime/server/routes/__skew/admin/stats.get'),
        })
      }

      // Multi-tab coordination and auto-reload handling
      if (options.multiTab !== false || (options.reloadStrategy && options.reloadStrategy !== 'prompt')) {
        addPlugin({
          src: resolver.resolve('./runtime/app/plugins/multi-tab.client'),
          mode: 'client',
        })
      }

      const shouldBundleAssets = options.bundleAssets !== false
      const shouldTrackBuildMetadata = options.trackBuildMetadata !== false || shouldBundleAssets

      // Build metadata and asset retention share storage, but remain independent capabilities.
      if (options.storage && shouldTrackBuildMetadata) {
        nuxt.hook('nitro:init', (nitro) => {
          const buildId = nuxt.options.runtimeConfig.app.buildId ||= nuxt.options.buildId
          let assetManager: ReturnType<typeof createAssetManager>

          // Process assets before rollup finalization
          nitro.hooks.hook('compiled', async () => {
            // Use publicDir directly - handles different nitro preset structures (Netlify, Vercel, etc.)
            const publicDir = nitro.options.output.publicDir

            assetManager = createAssetManager({
              retentionDays: options.retentionDays,
              maxNumberOfVersions: options.maxNumberOfVersions,
              debug: options.debug,
              buildAssetsDir: nuxt.options.app.buildAssetsDir,
              driver: await resolveBuildTimeDriver(options.storage!),
            })

            // Get list of assets from build
            const assets = await assetManager.getAssetsFromBuild(publicDir)

            // Persist the release before advertising or restoring it.
            await assetManager.storeVersion(buildId, publicDir, assets, { bundleAssets: shouldBundleAssets })

            // Expired releases must not be restored or advertised to clients.
            await assetManager.cleanupExpiredVersions(buildId)

            // Get release info for logging
            const manifest = await assetManager.getManifest()
            const totalReleases = Object.keys(manifest.versions).length
            const timestamps = Object.values(manifest.versions).map(v => new Date(v.timestamp).getTime())
            const oldestTimestamp = Math.min(...timestamps)
            const daysSince = Math.floor((Date.now() - oldestTimestamp) / (1000 * 60 * 60 * 24))
            const timeInfo = daysSince > 0 ? `${daysSince} day${daysSince > 1 ? 's' : ''} ago` : 'today'

            // Describe configured storage for release logging.
            const storageInfo = options.storage!.base
              ? `${colors.green(options.storage!.driver)} ${colors.gray(`(${options.storage!.base})`)}`
              : colors.green(options.storage!.driver)
            if (totalReleases === 1) {
              logger.warn(`No previous versions found in storage. This is either the first deployment or storage is misconfigured. https://nuxtseo.com/docs/skew-protection/storage-configuration`)
            }
            else {
              logger.log(`${shouldBundleAssets ? 'Storing' : 'Tracking'} ${colors.yellow(assets.length.toString())} assets for ${colors.cyan(buildId.slice(0, 8))} (${totalReleases} releases, oldest from ${timeInfo}) [${storageInfo}]`)
            }

            // Count versions (excluding current)
            const existingVersions = await assetManager.listExistingVersions()
            const versionCount = existingVersions.filter(v => v.id !== buildId).length

            logger.success(`Successfully ${shouldBundleAssets ? 'stored' : 'tracked'} ${assets.length} assets for latest release`)

            // For static/prerendered builds: restore old versioned assets into public directory
            if (shouldBundleAssets && versionCount > 0) {
              const updatedManifest = await assetManager.getManifest(buildId)
              let totalAssets = 0
              const versionSizes: string[] = []

              for (const [vId, vData] of Object.entries(updatedManifest.versions)) {
                if (vId !== buildId) {
                  totalAssets += vData.assets.length
                  versionSizes.push(`${vId.slice(0, 8)}:${vData.assets.length}`)
                }
              }

              logger.log(`Restoring build files from ${versionCount} release${versionCount > 1 ? 's' : ''} (${totalAssets} assets) [${versionSizes.join(', ')}]...`)
            }

            if (shouldBundleAssets)
              await assetManager.restoreOldAssetsToPublic(buildId, publicDir, assets)

            // Augment Nuxt build metadata files with skew protection data
            // Pass serverDir so we can patch Nitro's static asset manifest
            const serverDir = nitro.options.output.serverDir
            await assetManager.augmentBuildMetadata(buildId, publicDir, serverDir)
          })

          // Release storage resources on close.
          nitro.hooks.hook('close', async () => {
            if (assetManager)
              await assetManager.dispose()
          })
        })
      }

      // Register update strategy plugins
      if (resolvedStrategy === 'adapter' && isAdapter) {
        const adapter = options.updateStrategy as SkewAdapter
        // Store serializable adapter info
        // @ts-expect-error extending runtime config
        nuxt.options.runtimeConfig.public.skewProtection.adapterName = adapter.name

        // Validate adapter config at build time using zod schema
        const result = adapter.schema.safeParse(adapter.config)
        if (!result.success) {
          const errors = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')
          throw new Error(`${adapter.name} adapter config invalid: ${errors}`)
        }

        for (const dependency of adapter.dependencies) {
          if (await tryResolveModule(dependency, nuxt.options.rootDir))
            continue

          const msg = `The ${adapter.name} adapter requires \`${dependency}\`. Install with: npx nypm add ${dependency}`
          if (!nuxt.options.dev && !nuxt.options._prepare) {
            throw new Error(msg)
          }
          logger.warn(msg)
        }

        const adapterConfig = result.data
        const publicAdapterConfig = adapter.toPublicConfig(adapterConfig)

        // Only the explicitly public subscribe config is emitted into the client bundle.
        const template = addTemplate({
          filename: 'skew-adapter.mjs',
          getContents: () => `import { subscribe } from ${JSON.stringify(adapter.clientModule)}
export const config = ${JSON.stringify(publicAdapterConfig)}
export { subscribe }`,
        })
        nuxt.options.alias['#skew-adapter'] = template.dst

        addPlugin({
          src: resolver.resolve('./runtime/app/plugins/check-updates-adapter.client'),
          mode: 'client',
        })
      }
      else if (resolvedStrategy === 'ws') {
        if (!nuxt.options.nitro?.experimental?.websocket) {
          logger.warn('You need to enable `experimental.websocket` in your Nitro config to use WebSockets. Falling back to polling.')
        }
        else if (isCloudflareRuntime && nitroPreset !== 'cloudflare-durable') {
          logger.warn('Websockets are only supported in Cloudflare using `cloudflare-durable` preset. Falling back to polling.')
        }
        else {
          addServerHandler({
            route: `${basePath}/ws`,
            handler: resolver.resolve('./runtime/server/routes/__skew/ws'),
          })
          addPlugin(resolver.resolve('./runtime/app/plugins/check-updates-websocket.client'))
        }
      }
      else if (resolvedStrategy === 'sse') {
        if (isCloudflareRuntime) {
          logger.warn('SSE not supported on Cloudflare Workers (no persistent connections). Falling back to polling.')
        }
        else {
          addServerHandler({
            route: `${basePath}/sse`,
            handler: resolver.resolve('./runtime/server/routes/__skew/sse'),
          })
          // SSE is unidirectional so we need POST endpoints
          if (options.connectionTracking) {
            // Stats subscription endpoint
            addServerHandler({
              route: `${basePath}/subscribe-stats`,
              method: 'post',
              handler: resolver.resolve('./runtime/server/routes/__skew/subscribe-stats.post'),
            })
            // Route update endpoint
            if (options.routeTracking) {
              addServerHandler({
                route: `${basePath}/route`,
                method: 'post',
                handler: resolver.resolve('./runtime/server/routes/__skew/route.post'),
              })
            }
          }
          addPlugin({
            src: resolver.resolve('./runtime/app/plugins/check-updates-sse.client'),
            mode: 'client',
          })
        }
      }
    }
  },
})
