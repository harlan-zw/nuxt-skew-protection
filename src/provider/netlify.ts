import { z } from 'zod'

export const NETLIFY_SKEW_PROTECTION_CONFIG_PATH = '.netlify/v1/skew-protection.json'
export const NETLIFY_SKEW_PROTECTION_TOKEN_ENV = 'NETLIFY_SKEW_PROTECTION_TOKEN'
export const NETLIFY_SKEW_PROTECTION_COOKIE_NAME = 'netlify-skew-token'

const netlifySkewProtectionSourceSchema = z.object({
  type: z.enum(['cookie', 'header', 'query']),
  name: z.string(),
})

const netlifySkewProtectionConfigSchema = z.object({
  patterns: z.array(z.string()),
  sources: z.array(netlifySkewProtectionSourceSchema),
})

export type NetlifySkewProtectionSource = z.infer<typeof netlifySkewProtectionSourceSchema>
export type NetlifySkewProtectionConfig = z.infer<typeof netlifySkewProtectionConfigSchema>

export interface CreateNetlifySkewProtectionConfigInput {
  patterns: readonly string[]
  sources: readonly NetlifySkewProtectionSource[]
  /** Paths that must resolve against the current production deploy. */
  unpinnedPaths: readonly string[]
}

export interface CreateNetlifyNuxtSkewProtectionConfigInput {
  appBaseURL: string
  buildAssetsDir: string
  skewBasePath: string
}

export type NetlifySkewProtectionConfigError
  = | { _tag: 'patterns-required' }
    | { _tag: 'sources-required' }
    | { _tag: 'invalid-pattern', pattern: string, message: string }
    | { _tag: 'control-plane-protected', pattern: string, path: string }
    | { _tag: 'invalid-config', issues: readonly { path: string, message: string }[] }

export type NetlifySkewProtectionConfigResult
  = | { _tag: 'ok', value: NetlifySkewProtectionConfig }
    | { _tag: 'error', error: NetlifySkewProtectionConfigError }

function ok(value: NetlifySkewProtectionConfig): NetlifySkewProtectionConfigResult {
  return {
    _tag: 'ok',
    value,
  }
}

function error(value: NetlifySkewProtectionConfigError): NetlifySkewProtectionConfigResult {
  return {
    _tag: 'error',
    error: value,
  }
}

export function parseNetlifySkewProtectionConfig(input: unknown): NetlifySkewProtectionConfigResult {
  const result = netlifySkewProtectionConfigSchema.safeParse(input)
  if (result.success)
    return ok(result.data)

  return error({
    _tag: 'invalid-config',
    issues: result.error.issues.map(issue => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  })
}

export function createNetlifySkewProtectionConfig(
  input: CreateNetlifySkewProtectionConfigInput,
): NetlifySkewProtectionConfigResult {
  if (input.patterns.length === 0)
    return error({ _tag: 'patterns-required' })

  if (input.sources.length === 0)
    return error({ _tag: 'sources-required' })

  for (const pattern of input.patterns) {
    let matcher: RegExp
    try {
      matcher = new RegExp(pattern)
    }
    catch (cause) {
      return error({
        _tag: 'invalid-pattern',
        pattern,
        message: cause instanceof Error ? cause.message : String(cause),
      })
    }

    const protectedPath = input.unpinnedPaths.find(path => matcher.test(path))
    if (protectedPath) {
      return error({
        _tag: 'control-plane-protected',
        pattern,
        path: protectedPath,
      })
    }
  }

  return parseNetlifySkewProtectionConfig({
    patterns: [...input.patterns],
    sources: input.sources.map(source => ({ ...source })),
  })
}

function normalizeBasePath(value: string): string {
  const path = `/${value}`.replace(/\/{2,}/g, '/').replace(/\/$/, '')
  return path || '/'
}

function joinPath(base: string, path: string): string {
  return normalizeBasePath(`${base}/${path.replace(/^\/+/, '')}`)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function createNetlifyNuxtSkewProtectionConfig(
  input: CreateNetlifyNuxtSkewProtectionConfigInput,
): NetlifySkewProtectionConfigResult {
  const appBasePath = normalizeBasePath(input.appBaseURL)
  const buildAssetsPath = joinPath(appBasePath, input.buildAssetsDir)
  const apiPath = joinPath(appBasePath, 'api')
  const escapedAppBase = escapeRegex(appBasePath === '/' ? '/' : `${appBasePath}/`)
  const escapedBuildAssets = escapeRegex(`${buildAssetsPath}/`)
  const escapedApi = escapeRegex(`${apiPath}/`)

  return createNetlifySkewProtectionConfig({
    patterns: [
      `^${escapedBuildAssets}.*\\.(?:css|js|mjs|wasm|woff2?)$`,
      `^${escapedAppBase}(?:.*\\/)?_payload\\.json$`,
      `^${escapedApi}.*`,
    ],
    sources: [{ type: 'cookie', name: NETLIFY_SKEW_PROTECTION_COOKIE_NAME }],
    unpinnedPaths: [
      joinPath(buildAssetsPath, 'builds/latest.json'),
      joinPath(buildAssetsPath, 'builds/meta/current.json'),
      joinPath(input.skewBasePath, 'sse'),
      joinPath(input.skewBasePath, 'ws'),
    ],
  })
}

export function serializeNetlifySkewProtectionConfig(
  config: NetlifySkewProtectionConfig,
): string {
  return `${JSON.stringify(config, null, 2)}\n`
}
