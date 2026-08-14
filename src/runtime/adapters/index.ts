import type { SkewAdapter } from './types'

export type PublishSkewUpdateResult
  = | { _tag: 'ok' }
    | { _tag: 'invalid-config', issues: readonly { path: string, message: string }[] }

/** Publish after the deployment and latest manifest are live. */
export async function publishSkewUpdate(adapter: SkewAdapter, version: string): Promise<PublishSkewUpdateResult> {
  const config = adapter.schema.safeParse(adapter.config)
  if (!config.success) {
    return {
      _tag: 'invalid-config',
      issues: config.error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    }
  }

  await adapter.broadcast(config.data, version)
  return { _tag: 'ok' }
}

export function isSkewAdapter(value: unknown): value is SkewAdapter {
  return (
    typeof value === 'object'
    && value !== null
    && '_tag' in value
    && value._tag === 'SkewAdapter'
    && 'name' in value
    && 'schema' in value
    && 'clientModule' in value
    && 'toPublicConfig' in value
    && 'broadcast' in value
    && typeof (value as SkewAdapter).clientModule === 'string'
    && typeof (value as SkewAdapter).toPublicConfig === 'function'
    && typeof (value as SkewAdapter).broadcast === 'function'
  )
}

export type { AblyAdapterConfig } from './ably/types'

// Config types only - import adapters from provider/node or provider/web
export type { PusherAdapterConfig } from './pusher/types'
export type { SkewAdapter, SkewAdapterFactory } from './types'
export { defineAdapter, defineNodeBroadcast, defineWebSubscribe } from './types'
