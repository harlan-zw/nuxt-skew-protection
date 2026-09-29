import type { z } from 'zod'

export type AdapterConfigResult<TConfig>
  = | { _tag: 'Ok', config: TConfig }
    | { _tag: 'Err', issues: string[] }

export type BroadcastFn<T> = (config: T, version: string) => Promise<void>

export type SubscribeFn<T> = (config: T, onMessage: (msg: { version: string }) => void) => () => void

/**
 * A realtime provider for `updateStrategy`. It lives in nuxt.config, so every
 * field must survive Nuxt's deep clone of the config: plain data and functions,
 * never class instances.
 */
export interface SkewAdapter<TConfig = unknown, TPublicConfig extends Record<string, unknown> = Record<string, unknown>> {
  name: string
  config: TConfig
  /** Validate `config` at build time. */
  parseConfig: (config: unknown) => AdapterConfigResult<TConfig>
  /** The part of `config` that ships to the browser. Never include secrets. */
  toPublicConfig: (config: TConfig) => TPublicConfig
  /**
   * Module the client bundles: an absolute path, an alias such as `~/`, or a
   * package specifier. It must export `subscribe` (see `defineWebSubscribe`).
   */
  web: string
  /** Packages the build requires before it bundles `web`. */
  dependencies: string[]
  /** Runs on the build machine after a production build, with the new build id. */
  broadcast: BroadcastFn<TConfig>
}

export type SkewAdapterFactory<TConfig, TPublicConfig extends Record<string, unknown> = Record<string, unknown>> = (config: TConfig) => SkewAdapter<TConfig, TPublicConfig>

export interface DefineAdapterOptions<TConfig, TPublicConfig extends Record<string, unknown>> {
  name: string
  schema: z.ZodType<TConfig>
  toPublicConfig: (config: TConfig) => TPublicConfig
  web: string
  dependencies?: string[]
  broadcast: BroadcastFn<TConfig>
}

export function defineAdapter<TConfig, TPublicConfig extends Record<string, unknown>>(options: DefineAdapterOptions<TConfig, TPublicConfig>): SkewAdapterFactory<TConfig, TPublicConfig> {
  const parseConfig = (config: unknown): AdapterConfigResult<TConfig> => {
    const result = options.schema.safeParse(config)
    return result.success
      ? { _tag: 'Ok', config: result.data }
      : { _tag: 'Err', issues: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) }
  }
  return config => ({
    name: options.name,
    config,
    parseConfig,
    toPublicConfig: options.toPublicConfig,
    web: options.web,
    dependencies: options.dependencies || [],
    broadcast: options.broadcast,
  })
}

export const defineNodeBroadcast = <T>(broadcast: BroadcastFn<T>) => broadcast

export const defineWebSubscribe = <T>(subscribe: SubscribeFn<T>) => subscribe
