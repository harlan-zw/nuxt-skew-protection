import type { z } from 'zod'

export interface SkewAdapter<TConfig = unknown, TPublicConfig extends Record<string, unknown> = Record<string, unknown>> {
  _tag: 'SkewAdapter'
  name: string
  config: TConfig
  schema: z.ZodType<TConfig>
  clientModule: string
  dependencies: string[]
  toPublicConfig: (config: TConfig) => TPublicConfig
  broadcast: BroadcastFn<TConfig>
}

export type SkewAdapterFactory<TConfig, TPublicConfig extends Record<string, unknown> = Record<string, unknown>> = (config: TConfig) => SkewAdapter<TConfig, TPublicConfig>

export interface DefineAdapterOptions<TConfig, TPublicConfig extends Record<string, unknown>> {
  name: string
  schema: z.ZodType<TConfig>
  clientModule: string
  dependencies?: string[]
  toPublicConfig: (config: TConfig) => TPublicConfig
  broadcast: BroadcastFn<TConfig>
}

export type BroadcastFn<T> = (config: T, version: string) => Promise<void>

export type SubscribeFn<T> = (config: T, onMessage: (msg: { version: string }) => void) => () => void

export function defineAdapter<TConfig, TPublicConfig extends Record<string, unknown>>(options: DefineAdapterOptions<TConfig, TPublicConfig>): SkewAdapterFactory<TConfig, TPublicConfig> {
  return config => ({
    _tag: 'SkewAdapter',
    name: options.name,
    config,
    schema: options.schema,
    clientModule: options.clientModule,
    dependencies: options.dependencies || [],
    toPublicConfig: options.toPublicConfig,
    broadcast: options.broadcast,
  })
}

export const defineNodeBroadcast = <T>(broadcast: BroadcastFn<T>) => broadcast

export const defineWebSubscribe = <T>(subscribe: SubscribeFn<T>) => subscribe
