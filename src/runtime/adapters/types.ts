import type { z } from 'zod'

export interface SkewAdapter<TConfig = unknown, TPublicConfig extends Record<string, unknown> = Record<string, unknown>> {
  name: string
  config: TConfig
  schema: z.ZodType<TConfig>
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
  return config => ({
    name: options.name,
    config,
    schema: options.schema,
    toPublicConfig: options.toPublicConfig,
    subscribe: () => { throw new Error(`${options.name}.subscribe() - use web build`) },
    broadcast: () => { throw new Error(`${options.name}.broadcast() - use node build`) },
  })
}

export const defineNodeBroadcast = <T>(broadcast: BroadcastFn<T>) => broadcast

export const defineWebSubscribe = <T>(subscribe: SubscribeFn<T>) => subscribe
