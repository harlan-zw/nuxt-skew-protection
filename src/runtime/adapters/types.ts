import type { z } from 'zod'

export type AdapterConfigResult<TConfig>
  = | { _tag: 'Ok', config: TConfig }
    | { _tag: 'Err', issues: string[] }

export interface SkewAdapter<TConfig = unknown, TPublicConfig extends Record<string, unknown> = Record<string, unknown>> {
  name: string
  config: TConfig
  /**
   * Validate `config`. A function, not a schema instance: Nuxt deep clones
   * nuxt.config, and the clone breaks class instances such as zod schemas.
   */
  parseConfig: (config: unknown) => AdapterConfigResult<TConfig>
  toPublicConfig: (config: TConfig) => TPublicConfig
  subscribe: (onMessage: (msg: { version: string }) => void) => () => void
  broadcast: (version: string) => Promise<void>
}

export type SkewAdapterFactory<TConfig, TPublicConfig extends Record<string, unknown> = Record<string, unknown>> = (config: TConfig) => SkewAdapter<TConfig, TPublicConfig>

export interface DefineAdapterOptions<TConfig, TPublicConfig extends Record<string, unknown>> {
  name: string
  schema: z.ZodType<TConfig>
  toPublicConfig: (config: TConfig) => TPublicConfig
}

export type BroadcastFn<T> = (config: T, version: string) => Promise<void>

export type SubscribeFn<T> = (config: T, onMessage: (msg: { version: string }) => void) => () => void

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
    subscribe: () => { throw new Error(`${options.name}.subscribe() - use web build`) },
    broadcast: () => { throw new Error(`${options.name}.broadcast() - use node build`) },
  })
}

export const defineNodeBroadcast = <T>(broadcast: BroadcastFn<T>) => broadcast

export const defineWebSubscribe = <T>(subscribe: SubscribeFn<T>) => subscribe
