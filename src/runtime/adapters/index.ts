import type { SkewAdapter } from './types'

export function isSkewAdapter(value: unknown): value is SkewAdapter {
  return (
    typeof value === 'object'
    && value !== null
    && 'name' in value
    && 'subscribe' in value
    && 'broadcast' in value
    && typeof (value as SkewAdapter).subscribe === 'function'
    && typeof (value as SkewAdapter).broadcast === 'function'
  )
}

export type { AblyAdapterConfig } from './ably/types'

// Config types only - import adapters from provider/node or provider/web
export type { PusherAdapterConfig } from './pusher/types'
export type { SkewAdapter, SkewAdapterFactory } from './types'
