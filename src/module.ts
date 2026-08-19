import type { CookieSerializeOptions } from 'cookie-es'
import type { BroadcastFn, SkewAdapter } from './runtime/adapters/types'
import type { NuxtSkewProtectionPrivateRuntimeConfig, NuxtSkewProtectionRuntimeConfig } from './runtime/types'
import { existsSync } from 'node:fs'
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
import { resolveBundleAssets } from './provider-defaults'
import { resolveBasePath, resolveBuildAssetsPath, resolveCookieName } from './resolve-base-path'
import { overlongRoutes, resolveHtmlCacheHeadersOptions, skewCacheCeilingSeconds } from './runtime/server/utils/html-cache-policy'
import { resolveBuildTimeDriver } from './unstorage/utils'
import { isSkewAdapter } from './utils'
import {
  createCloudflareAssetProtectionPlugin,
  withoutCloudflareAssetProtectionPlugin,
} from './utils/cloudflare-cache-protection'
import { withCloudflareBuildAssetRouting } from './utils/cloudflare-routing'
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
   * Emit shared-cache headers on anonymous HTML documents.
   *
   * Off by default. Retaining old builds makes a cached document safe to serve,
   * because the chunks it names outlive the deploy that replaced them, so this
   * is the payoff for skew protection rather than a separate concern.
   *
   * Freshness is per route, because content is. Set a default and override the
   * pages that change on a different clock:
   *
   * ```ts
   * htmlCacheHeaders: {
   *   maxAge: 60,
   *   routes: {
   *     '/gh/**': { maxAge: 300 },        // rebuilt when a repo syncs
   *     '/blog/**': { maxAge: 3600 },     // changes when someone publishes
   *     '/account/**': false,             // never shared
   *   },
   * }
   * ```
   *
   * Patterns are `/exact`, `/prefix/*` for one segment, and `/prefix/**` for
   * any depth. The most specific match wins. Routes with no match take the
   * defaults.
   *
   * If your app already owns a cache policy, leave `routes` empty and keep
   * yours: a response that already carries `Cache-Control` is never touched.
   * Clamp your own numbers with `skewCacheCeilingSeconds` so they stay inside
   * the window retention can actually promise.
   *
   * It is opt-in because the module cannot see whether a rendered document
   * depends on who requested it. A request carrying cookies never populates the
   * cache, but shared caches key on the URL and do not vary on Cookie, so a
   * stored anonymous document will be served to signed-in visitors too. Opt
   * those routes out.
   *
   * Keep each window shorter than the wall-clock time your last
   * `maxNumberOfVersions` deploys span. That is the real bound and it cannot be
   * checked at build time: `retentionDays` is a ceiling, deploy rate decides
   * the floor.
   *
   * Two platform notes. Cloudflare does not cache HTML off headers alone, so
   * this needs a Cache Rule with "Eligible for cache" on the document routes
   * before it does anything. And it has no effect on Vercel at all, because
   * Vercel skew protection sets a `__vdpl` cookie on every document and shared
   * caches will not store a response carrying Set-Cookie.
   *
   * Enabling it stops cacheable documents setting the version cookie, so
   * `isClientOutdated` and the version an SSE connection reports fall back to
   * the server's own build id.
   *
   * @default false
   */
  htmlCacheHeaders?: boolean | {
    /**
     * Seconds a shared cache may serve a document without revalidating.
     * @default 60
     */
    maxAge?: number
    /**
     * Seconds a shared cache may serve a stale document while it revalidates.
     * @default 60
     */
    staleWhileRevalidate?: number
    /**
     * Per-route overrides. `false` opts a route out entirely.
     */
    routes?: Record<string, false | { maxAge?: number, staleWhileRevalidate?: number }>
  }
  /**
   * Strategy for checking for version updates
   * - 'polling': Nuxt's native polling of builds/latest.json (default)
   * - 'sse': Use Server-Sent Events for real-time updates
   * - 'ws': Use WebSocket (requires cloudflare-durable preset or experimental.websocket)
   * - SkewAdapter: Third-party WebSocket provider (Pusher, Ably)
   * @default Static: 'polling', Node: 'sse', Cloudflare: 'ws'
   */
  updateStrategy?: 'polling' | 'sse' | 'ws' | SkewAdapter
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
   * @default true, or false when native Vercel Skew Protection is active
   * @note Automatically disabled when using a CDN URL or native Vercel Skew Protection
   */
  bundleAssets?: boolean
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
   * How to handle outdated chunks.
   * - 'prompt': Show notification, let user decide (default)
   * - 'immediate': Reload immediately when chunks are invalidated
   * - 'idle': Reload when user is idle (requestIdleCallback + visibility API)
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
    htmlCacheHeaders: false,
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

    const bundleAssetsResolution = resolveBundleAssets(options)
    options.bundleAssets = bundleAssetsResolution.bundleAssets
    if (bundleAssetsResolution._tag === 'vercel-native') {
      logger.info('Vercel Skew Protection detected. Persistent asset storage is disabled. Build metadata tracking remains enabled. Set `bundleAssets: true` to override.')
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

    // Detect Nitro preset
    const nitroPreset = resolveNitroPreset(nuxt.options.nitro)
    const usesCloudflareAssets = nitroPreset === 'cloudflare-module' || nitroPreset === 'cloudflare-durable'
    const buildAssetsPath = resolveBuildAssetsPath(nuxt.options.app)
    const recoveryPath = `${basePath}/asset`

    // @ts-expect-error untyped
    nuxt.options.runtimeConfig.public.skewProtection = {
      basePath,
      assetRecovery: usesCloudflareAssets
        ? {
            _tag: 'cloudflare',
            buildAssetsPath,
            recoveryPath,
          }
        : { _tag: 'disabled' },
      cookie: options.cookie as Required<NuxtSkewProtectionRuntimeConfig['cookie']>,
      debug: options.debug,
      connectionTracking: options.connectionTracking,
      routeTracking: options.connectionTracking && options.routeTracking,
      ipTracking: options.connectionTracking && options.ipTracking,
      reloadStrategy: options.reloadStrategy ?? 'prompt',
      multiTab: options.multiTab ?? true,
      version,
    } as Required<NuxtSkewProtectionRuntimeConfig>

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
import type { ChunksOutdatedPayload, SkewAdapterConfig, SkewConnection, SkewSSEConfig, SkewWebSocketConfig } from '#skew-protection/app/types'

declare module '#app' {
  interface RuntimeNuxtHooks {
    'skew:chunks-outdated': (payload: ChunksOutdatedPayload) => void | Promise<void>
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
        assets: string[]
        deletedChunks?: string[]
      }>
    }
  }
}

declare module 'nuxt/app' {
  interface RuntimeNuxtHooks {
    'skew:chunks-outdated': (payload: ChunksOutdatedPayload) => void | Promise<void>
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
        assets: string[]
        deletedChunks?: string[]
      }>
    }
  }
}

export type { ChunksOutdatedPayload, SkewAdapterConfig, SkewConnection, SkewSSEConfig, SkewWebSocketConfig }
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
      // Detect platform at build time (reuse nitroPreset from above)
      const isCloudflareRuntime = nitroPreset?.includes('cloudflare')
      const isVercel = nitroPreset?.includes('vercel') || process.env.VERCEL_SKEW_PROTECTION_ENABLED === '1'
      const isStatic = isStaticPreset(nuxt)

      if (nitroPreset === 'cloudflare-module' || nitroPreset === 'cloudflare-durable') {
        // Nitro returns static assets before H3 hooks run. Decorate the Worker
        // entry so changes to Nitro's private adapter source do not affect us.
        nuxt.hook('nitro:config', (nitroConfig) => {
          nitroConfig.cloudflare ||= {}
          nitroConfig.cloudflare.wrangler ||= {}
          nitroConfig.cloudflare.wrangler.assets ||= {}
          nitroConfig.cloudflare.wrangler.assets.run_worker_first = withCloudflareBuildAssetRouting(
            nitroConfig.cloudflare.wrangler.assets.run_worker_first,
            nuxt.options.app.buildAssetsDir,
          )
          nitroConfig.rollupConfig ||= {}
          const existingPlugins = nitroConfig.rollupConfig.plugins
          nitroConfig.rollupConfig.plugins = [
            ...(Array.isArray(existingPlugins) ? existingPlugins : existingPlugins ? [existingPlugins] : []),
            createCloudflareAssetProtectionPlugin({
              buildAssetsPath,
              recoveryPath,
              runtimeHelperId: resolver.resolve('./runtime/server/utils/cloudflare-asset-fetch'),
            }),
          ]
        })
        nuxt.hook('nitro:init', (nitro) => {
          nitro.hooks.hook('prerender:config', (prerenderConfig) => {
            const plugins = prerenderConfig.rollupConfig?.plugins
            if (Array.isArray(plugins))
              prerenderConfig.rollupConfig!.plugins = withoutCloudflareAssetProtectionPlugin(plugins)
          })
        })
      }

      // Determine resolved strategy
      const isAdapter = isSkewAdapter(options.updateStrategy)
      let resolvedStrategy: 'polling' | 'sse' | 'ws' | 'adapter' = 'polling'

      if (isAdapter) {
        resolvedStrategy = 'adapter'
      }
      else if (options.updateStrategy === 'ws') {
        resolvedStrategy = 'ws'
      }
      else if (options.updateStrategy === 'sse') {
        resolvedStrategy = 'sse'
      }
      else if (!options.updateStrategy) {
        // Auto-detect: static = polling, cloudflare = ws, otherwise sse
        resolvedStrategy = isStatic ? 'polling' : isCloudflareRuntime ? 'ws' : 'sse'
      }

      // Validate strategy compatibility with static generation
      if (isStatic && resolvedStrategy !== 'polling' && resolvedStrategy !== 'adapter') {
        logger.warn(`Strategy "${resolvedStrategy}" requires a server but static generation detected. Falling back to polling.`)
        resolvedStrategy = 'polling'
      }

      if (isVercel) {
        nuxt.options.runtimeConfig.skewProtection = {
          ...(typeof nuxt.options.runtimeConfig.skewProtection === 'object'
            ? nuxt.options.runtimeConfig.skewProtection
            : {}),
          vercelCookiePath: nuxt.options.app.baseURL,
        } satisfies NuxtSkewProtectionPrivateRuntimeConfig
        addServerHandler({
          handler: resolver.resolve('./runtime/server/middleware/vercel-skew'),
          middleware: true,
        })
      }

      const htmlCacheHeaders = resolveHtmlCacheHeadersOptions(options.htmlCacheHeaders)
      if (htmlCacheHeaders) {
        const ceiling = skewCacheCeilingSeconds(options.retentionDays ?? 0)
        const overlong = overlongRoutes(htmlCacheHeaders, ceiling)
        if (isVercel) {
          // Vercel pins each document to a deployment with the `__vdpl` cookie,
          // and a shared cache will not store a response that sets one. The two
          // designs cannot both hold: one wants a cookie per document, the
          // other wants one document for everyone. Say so rather than shipping
          // an option that quietly does nothing.
          logger.warn('htmlCacheHeaders has no effect on Vercel. Vercel skew protection sets a `__vdpl` cookie on every document, and shared caches will not store a response carrying Set-Cookie.')
        }
        else if (overlong.length) {
          // Name the rule to change. "Your config is too long" sends the reader
          // back through every route to work out which one.
          for (const { route, seconds } of overlong)
            logger.warn(`htmlCacheHeaders ${route} keeps a document for up to ${seconds}s but retentionDays only keeps a build for ${ceiling}s. A cached document will outlive its chunks.`)
        }
        else {
          const routeCount = Object.keys(htmlCacheHeaders.routes).length
          const scope = routeCount ? `, plus ${routeCount} route override${routeCount === 1 ? '' : 's'}` : ''
          logger.info(`htmlCacheHeaders: anonymous documents are shared-cached for up to ${htmlCacheHeaders.maxAge + htmlCacheHeaders.staleWhileRevalidate}s by default${scope}. Keep each window under the time your last ${options.maxNumberOfVersions} deploys span.`)
        }
        nuxt.options.runtimeConfig.skewProtection = {
          ...(typeof nuxt.options.runtimeConfig.skewProtection === 'object'
            ? nuxt.options.runtimeConfig.skewProtection
            : {}),
          htmlCacheHeaders,
        } satisfies NuxtSkewProtectionPrivateRuntimeConfig
        nuxt.options.nitro = nuxt.options.nitro || {}
        nuxt.options.nitro.plugins = nuxt.options.nitro.plugins || []
        nuxt.options.nitro.plugins.push(resolver.resolve('./runtime/server/plugins/html-cache-headers'))
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

      addPlugin({
        src: resolver.resolve('./runtime/app/plugins/sw-track-user-modules.client'),
        mode: 'client',
      })

      // Multi-tab coordination and auto-reload handling
      if (options.multiTab !== false || (options.reloadStrategy && options.reloadStrategy !== 'prompt')) {
        addPlugin({
          src: resolver.resolve('./runtime/app/plugins/multi-tab.client'),
          mode: 'client',
        })
      }

      // allow us to use the non-transpiled version of the service worker from the module or root dir
      let swPath = resolver.resolve('./sw')
      if (!existsSync(swPath)) {
        // fallback to root dir
        swPath = resolver.resolve('../sw')
      }
      // Add service worker as public asset
      nuxt.options.nitro = nuxt.options.nitro || {}
      nuxt.options.nitro.publicAssets = nuxt.options.nitro.publicAssets || []
      nuxt.options.nitro.publicAssets.push({
        dir: swPath,
        maxAge: 0, // Service workers should not be cached
      })

      // Build metadata is required by chunk invalidation, even when providers retain asset bytes.
      if (options.storage) {
        nuxt.hook('nitro:init', (nitro) => {
          const buildId = nuxt.options.runtimeConfig.app.buildId ||= nuxt.options.buildId
          let assetManager: ReturnType<typeof createAssetManager>

          // Process assets before rollup finalization
          nitro.hooks.hook('compiled', async () => {
            // Use publicDir directly - handles different nitro preset structures (Netlify, Vercel, etc.)
            const publicDir = nitro.options.output.publicDir

            assetManager = createAssetManager({
              ...options,
              buildAssetsDir: nuxt.options.app.buildAssetsDir,
              persistAssets: options.bundleAssets !== false,
              driver: await resolveBuildTimeDriver(options.storage!),
            })

            // Get list of assets from build
            const assets = await assetManager.getAssetsFromBuild(publicDir)

            // Update versions manifest
            const { isExistingVersion } = await assetManager.updateVersionsManifest(buildId, assets)

            if (options.bundleAssets) {
              // Get release info for logging
              const manifest = await assetManager.getManifest()
              const totalReleases = Object.keys(manifest.versions).length
              const timestamps = Object.values(manifest.versions).map(v => new Date(v.timestamp).getTime())
              const oldestTimestamp = Math.min(...timestamps)
              const daysSince = Math.floor((Date.now() - oldestTimestamp) / (1000 * 60 * 60 * 24))
              const timeInfo = daysSince > 0 ? `${daysSince} day${daysSince > 1 ? 's' : ''} ago` : 'today'

              // Store assets in configured storage (can be slow with many assets)
              const storageInfo = options.storage!.base
                ? `${colors.green(options.storage!.driver)} ${colors.gray(`(${options.storage!.base})`)}`
                : colors.green(options.storage!.driver)
              if (totalReleases === 1) {
                logger.warn(`No previous versions found in storage. This is either the first deployment or storage is misconfigured. https://nuxtseo.com/docs/skew-protection/storage-configuration`)
              }
              else {
                logger.log(`Storing ${colors.yellow(assets.length.toString())} assets for ${colors.cyan(buildId.slice(0, 8))} (${totalReleases} releases, oldest from ${timeInfo}) [${storageInfo}]`)
              }

              await assetManager.storeAssetsInStorage(buildId, publicDir, assets)
                .catch((error: unknown) => {
                  logger.error(`Failed to store assets:`, error instanceof Error ? error.message : error)
                  throw error
                })

              // Count versions (excluding current)
              const existingVersions = await assetManager.listExistingVersions()
              const versionCount = existingVersions.filter(v => v.id !== buildId).length

              logger.success(`Successfully stored ${assets.length} assets for latest release`)

              // For static/prerendered builds: restore old versioned assets into public directory
              if (versionCount > 0) {
                // Re-read manifest after storeAssetsInStorage to get post-deduplication counts
                const updatedManifest = await assetManager.getManifest()
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

              await assetManager.restoreOldAssetsToPublic(buildId, publicDir, assets, isExistingVersion)
            }

            // Augment Nuxt build metadata files with skew protection data
            // Pass serverDir so we can patch Nitro's static asset manifest
            const serverDir = nitro.options.output.serverDir
            await assetManager.augmentBuildMetadata(buildId, publicDir, serverDir)
          })

          // Clean up expired versions on close
          nitro.hooks.hook('close', async () => {
            if (assetManager) {
              await assetManager.cleanupExpiredVersions().catch((error) => {
                logger.debug('Failed to clean up expired skew protection versions:', error)
              })
              await assetManager.dispose()
            }
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

        const publicAdapterConfig = adapter.toPublicConfig(result.data)

        // Check for adapter dependencies at build time
        if (adapter.name === 'pusher') {
          if (!await tryResolveModule('pusher-js', nuxt.options.rootDir)) {
            const msg = `The pusher adapter requires \`pusher-js\`. Install with: npx nypm add pusher-js`
            if (!nuxt.options.dev && !nuxt.options._prepare) {
              throw new Error(msg)
            }
            else {
              logger.warn(msg)
            }
          }
        }
        else if (adapter.name === 'ably') {
          if (!await tryResolveModule('ably', nuxt.options.rootDir)) {
            const msg = `The ably adapter requires \`ably\`. Install with: npx nypm add ably`
            if (!nuxt.options.dev && !nuxt.options._prepare) {
              throw new Error(msg)
            }
            else {
              logger.warn(msg)
            }
          }
        }

        // Create template that imports from the actual adapter module (web build for client)
        const template = addTemplate({
          filename: 'skew-adapter.mjs',
          getContents: () => `import { subscribe } from 'nuxt-skew-protection/adapters/${adapter.name}/web'
export const config = ${JSON.stringify(publicAdapterConfig)}
export { subscribe }`,
        })
        nuxt.options.alias['#skew-adapter'] = template.dst

        addPlugin({
          src: resolver.resolve('./runtime/app/plugins/check-updates-adapter.client'),
          mode: 'client',
        })

        // Broadcast version update after build completes (not dev/prepare)
        if (!nuxt.options.dev && !nuxt.options._prepare) {
          nuxt.hook('close', async () => {
            const buildId = nuxt.options.runtimeConfig.app.buildId || nuxt.options.buildId
            const channel = (adapter.config as { channel?: string }).channel || 'skew-protection'
            logger.log(`Broadcasting update ${colors.cyan(buildId.slice(0, 8))} via ${colors.green(adapter.name)} (channel: ${colors.gray(channel)})`)

            let broadcastFn: BroadcastFn<any>
            switch (adapter.name) {
              case 'pusher': {
                const { broadcast } = await import('./runtime/adapters/pusher/node')
                broadcastFn = broadcast
                break
              }
              case 'ably': {
                const { broadcast } = await import('./runtime/adapters/ably/node')
                broadcastFn = broadcast
                break
              }
              default:
                logger.warn(`No broadcast implementation for adapter: ${adapter.name}`)
                return
            }

            await broadcastFn(adapter.config, buildId)
              .then(() => logger.success(`Broadcast complete`))
              .catch((err: Error) => logger.error(`Broadcast failed: ${err.message}`))
          })
        }
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
