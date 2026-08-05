import type { z } from 'zod'

export interface SkewAdapter<TConfig = unknown> {
  _tag: 'SkewAdapter'
  name: string
  config: TConfig
  schema: z.ZodType<TConfig>
  clientModule: string
  dependencies: string[]
  toPublicConfig: (config: TConfig) => Record<string, unknown>
  broadcast: BroadcastFn<TConfig>
}

export type SkewAdapterFactory<T> = (config: T) => SkewAdapter<T>

export interface DefineAdapterOptions<T> {
  name: string
  schema: z.ZodType<T>
  clientModule: string
  dependencies?: string[]
  toPublicConfig: (config: T) => Record<string, unknown>
  broadcast: BroadcastFn<T>
}

export type BroadcastFn<T> = (config: T, version: string) => Promise<void>

export type SubscribeFn<T> = (config: T, onMessage: (msg: { version: string }) => void) => () => void

export function defineAdapter<T>(options: DefineAdapterOptions<T>): SkewAdapterFactory<T> {
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
