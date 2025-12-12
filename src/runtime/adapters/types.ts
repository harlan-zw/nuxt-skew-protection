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
