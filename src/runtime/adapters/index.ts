import type { SkewAdapter } from './types'

export function isSkewAdapter(value: unknown): value is SkewAdapter {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as SkewAdapter).name === 'string'
    && typeof (value as SkewAdapter).web === 'string'
    && typeof (value as SkewAdapter).parseConfig === 'function'
    && typeof (value as SkewAdapter).toPublicConfig === 'function'
    && typeof (value as SkewAdapter).broadcast === 'function'
  )
}

export type { AblyAdapterConfig } from './ably/types'

// Config types only - import adapters from provider/node or provider/web
export type { PusherAdapterConfig } from './pusher/types'
export type { AdapterConfigResult, BroadcastFn, DefineAdapterOptions, SkewAdapter, SkewAdapterFactory, SubscribeFn } from './types'
export { defineAdapter, defineNodeBroadcast, defineWebSubscribe } from './types'
