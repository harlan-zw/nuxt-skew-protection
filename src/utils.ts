import type { BroadcastFn, DefineAdapterOptions, SkewAdapter, SkewAdapterFactory, SubscribeFn } from './runtime/adapters/types'

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
