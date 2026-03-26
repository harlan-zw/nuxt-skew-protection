import type { z } from 'zod'

export interface SkewAdapter<TConfig = unknown> {
  name: string
  config: TConfig
  schema: z.ZodType<TConfig>
  subscribe: (onMessage: (msg: { version: string }) => void) => () => void
  broadcast: (version: string) => Promise<void>
}

export type SkewAdapterFactory<T> = (config: T) => SkewAdapter<T>

export interface DefineAdapterOptions<T> {
  name: string
  schema: z.ZodType<T>
}

export type BroadcastFn<T> = (config: T, version: string) => Promise<void>

export type SubscribeFn<T> = (config: T, onMessage: (msg: { version: string }) => void) => () => void

export function defineAdapter<T>(options: DefineAdapterOptions<T>): SkewAdapterFactory<T> {
  return config => ({
    name: options.name,
    config,
    schema: options.schema,
    subscribe: () => { throw new Error(`${options.name}.subscribe() - use web build`) },
    broadcast: () => { throw new Error(`${options.name}.broadcast() - use node build`) },
  })
}

export const defineNodeBroadcast = <T>(broadcast: BroadcastFn<T>) => broadcast

export const defineWebSubscribe = <T>(subscribe: SubscribeFn<T>) => subscribe
