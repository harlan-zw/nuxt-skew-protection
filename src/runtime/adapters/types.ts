export type AdapterConfigResult<TConfig>
  = | { _tag: 'Ok', config: TConfig }
    | { _tag: 'Err', issues: string[] }

export type AdapterConfigParser<TConfig> = (config: unknown) => AdapterConfigResult<TConfig>

type StandardSchemaResult<TOutput>
  = | { readonly value: TOutput, readonly issues?: undefined }
    | { readonly issues: ReadonlyArray<{ readonly message: string, readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined }> }

/**
 * The part of the Standard Schema interface (https://standardschema.dev) that
 * `defineAdapter` reads. zod, Valibot and ArkType schemas implement it, so the
 * module validates adapter config without a dependency on any of them.
 */
export interface StandardSchemaV1<TOutput = unknown> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => StandardSchemaResult<TOutput> | Promise<StandardSchemaResult<TOutput>>
    readonly types?: { readonly input: unknown, readonly output: TOutput } | undefined
  }
}

/** A parse function, or a Standard Schema such as a zod object. */
export type AdapterConfigSchema<TConfig> = AdapterConfigParser<TConfig> | StandardSchemaV1<TConfig>

export type BroadcastFn<T> = (config: T, version: string) => Promise<void>

export type SubscribeFn<T> = (config: T, onMessage: (msg: { version: string }) => void) => () => void

/**
 * A realtime provider for `updateStrategy`. It lives in nuxt.config, so every
 * field must survive Nuxt's deep clone of the config: plain data and functions,
 * never class instances.
 */
export interface SkewAdapter<TConfig = unknown, TPublicConfig extends Record<string, unknown> = Record<string, unknown>> {
  name: string
  config: TConfig
  /** Validate `config` at build time. */
  parseConfig: AdapterConfigParser<TConfig>
  /** The part of `config` that ships to the browser. Never include secrets. */
  toPublicConfig: (config: TConfig) => TPublicConfig
  /**
   * Module the client bundles: an absolute path, an alias such as `~/`, or a
   * package specifier. It must export `subscribe` (see `defineWebSubscribe`).
   */
  web: string
  /** Packages the build requires before it bundles `web`. */
  dependencies: string[]
  /** Runs on the build machine after a production build, with the new build id. */
  broadcast: BroadcastFn<TConfig>
}

export type SkewAdapterFactory<TConfig, TPublicConfig extends Record<string, unknown> = Record<string, unknown>> = (config: TConfig) => SkewAdapter<TConfig, TPublicConfig>

export interface DefineAdapterOptions<TConfig, TPublicConfig extends Record<string, unknown>> {
  name: string
  schema: AdapterConfigSchema<TConfig>
  toPublicConfig: (config: TConfig) => TPublicConfig
  web: string
  dependencies?: string[]
  broadcast: BroadcastFn<TConfig>
}

function toConfigParser<TConfig>(schema: AdapterConfigSchema<TConfig>): AdapterConfigParser<TConfig> {
  if (!('~standard' in schema))
    return schema
  return (config) => {
    const result = schema['~standard'].validate(config)
    if (result instanceof Promise)
      return { _tag: 'Err', issues: ['config: async schemas are not supported, use a synchronous schema'] }
    if (result.issues) {
      return {
        _tag: 'Err',
        issues: result.issues.map(({ message, path }) => {
          const key = path?.map(segment => String(typeof segment === 'object' ? segment.key : segment)).join('.')
          return `${key || 'config'}: ${message}`
        }),
      }
    }
    return { _tag: 'Ok', config: result.value }
  }
}

export function defineAdapter<TConfig, TPublicConfig extends Record<string, unknown>>(options: DefineAdapterOptions<TConfig, TPublicConfig>): SkewAdapterFactory<TConfig, TPublicConfig> {
  const parseConfig = toConfigParser(options.schema)
  return config => ({
    name: options.name,
    config,
    parseConfig,
    toPublicConfig: options.toPublicConfig,
    web: options.web,
    dependencies: options.dependencies || [],
    broadcast: options.broadcast,
  })
}

/**
 * Parses an object whose fields are all strings: each `required` key maps to
 * its error message, and `optional` keys may be absent. Unknown keys are dropped.
 */
export function parseStringConfig<TRequired extends string, TOptional extends string>(
  input: unknown,
  required: Record<TRequired, string>,
  optional: readonly TOptional[],
): AdapterConfigResult<Record<TRequired, string> & Partial<Record<TOptional, string>>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return { _tag: 'Err', issues: ['config: expected an object'] }
  const fields = input as Record<string, unknown>
  const config: Record<string, string> = {}
  const issues: string[] = []
  for (const [key, message] of Object.entries<string>(required)) {
    const value = fields[key]
    if (typeof value === 'string' && value.length > 0)
      config[key] = value
    else
      issues.push(`${key}: ${message}`)
  }
  for (const key of optional) {
    const value = fields[key]
    if (typeof value === 'string')
      config[key] = value
    else if (value !== undefined)
      issues.push(`${key}: expected a string`)
  }
  return issues.length
    ? { _tag: 'Err', issues }
    : { _tag: 'Ok', config: config as Record<TRequired, string> & Partial<Record<TOptional, string>> }
}

export const defineNodeBroadcast = <T>(broadcast: BroadcastFn<T>) => broadcast

export const defineWebSubscribe = <T>(subscribe: SubscribeFn<T>) => subscribe
