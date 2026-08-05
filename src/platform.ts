export type SkewPlatform = 'aws' | 'cloudflare' | 'netlify' | 'node' | 'static' | 'vercel' | 'generic'
export type PortableUpdateStrategy = 'polling' | 'sse' | 'ws' | 'adapter'
export type PlatformMode = 'portable' | 'native' | 'hybrid'
export type PlatformModeOption = Exclude<PlatformMode, 'hybrid'> | {
  mode: 'hybrid'
  discoveryURL: string
}

export interface ResolvePlatformInput {
  preset?: string
  isStatic: boolean
  websocket: boolean
  responseStreaming?: boolean
  env: Record<string, string | undefined>
  mode?: PlatformModeOption
  updateStrategy?: PortableUpdateStrategy | false
}

export type PlatformResolution = {
  _tag: 'resolved'
  platform: SkewPlatform
  mode: PlatformMode
  updateStrategy: PortableUpdateStrategy | false
  discoveryURL?: string
  nativeDeploymentId?: string
  warnings: string[]
} | {
  _tag: 'invalid'
  code: 'discovery-url-required' | 'native-unavailable'
  platform: SkewPlatform
  message: string
}

function detectPlatform(preset: string, isStatic: boolean): SkewPlatform {
  if (isStatic || preset === 'static')
    return 'static'
  if (preset.includes('vercel'))
    return 'vercel'
  if (preset.includes('cloudflare'))
    return 'cloudflare'
  if (preset.includes('netlify'))
    return 'netlify'
  if (preset.includes('aws') || preset.includes('lambda'))
    return 'aws'
  if (preset.includes('node'))
    return 'node'
  return 'generic'
}

function parseMode(mode: PlatformModeOption | undefined): { mode?: PlatformMode, discoveryURL?: string } {
  return typeof mode === 'string' ? { mode } : (mode || {})
}

export function resolvePlatform(input: ResolvePlatformInput): PlatformResolution {
  const preset = input.preset || ''
  const platform = detectPlatform(preset, input.isStatic)
  const requested = parseMode(input.mode)
  const nativeDeploymentId = input.env.VERCEL_SKEW_PROTECTION_ENABLED === '1'
    ? input.env.VERCEL_DEPLOYMENT_ID
    : undefined
  const nativeAvailable = (platform === 'vercel' && !!nativeDeploymentId)
    || (platform === 'netlify' && !!input.env.NETLIFY_SKEW_PROTECTION_TOKEN)
  const mode = requested.mode || (nativeAvailable && !input.updateStrategy ? 'native' : 'portable')

  const hybridAvailable = nativeAvailable || platform === 'cloudflare'
  if ((mode === 'native' && !nativeAvailable) || (mode === 'hybrid' && !hybridAvailable)) {
    return {
      _tag: 'invalid',
      code: 'native-unavailable',
      platform,
      message: `Native skew protection is unavailable for the ${platform} platform.`,
    }
  }
  if (mode === 'hybrid' && !requested.discoveryURL?.trim()) {
    return {
      _tag: 'invalid',
      code: 'discovery-url-required',
      platform,
      message: 'Hybrid mode requires an unpinned discoveryURL for the latest Nuxt app manifest.',
    }
  }
  if (mode === 'native') {
    return {
      _tag: 'resolved',
      platform,
      mode,
      updateStrategy: false,
      nativeDeploymentId,
      warnings: [],
    }
  }
  if (mode === 'hybrid') {
    return {
      _tag: 'resolved',
      platform,
      mode,
      updateStrategy: input.updateStrategy ?? 'polling',
      discoveryURL: requested.discoveryURL,
      nativeDeploymentId,
      warnings: [],
    }
  }

  const warnings: string[] = []
  let updateStrategy = input.updateStrategy
  if (updateStrategy === undefined) {
    updateStrategy = platform === 'node' || platform === 'generic'
      ? 'sse'
      : preset === 'cloudflare-durable' && input.websocket
        ? 'ws'
        : 'polling'
  }

  const serverless = platform === 'aws' || platform === 'netlify' || platform === 'vercel' || platform === 'cloudflare'
  if (updateStrategy === 'sse' && platform === 'aws' && preset.includes('lambda')) {
    if (!input.responseStreaming) {
      warnings.push('AWS Lambda SSE requires nitro.awsLambda.streaming: true; using polling.')
      updateStrategy = 'polling'
    }
    else {
      warnings.push('SSE keeps a Lambda invocation open and billed until disconnect or timeout.')
    }
  }
  else if (updateStrategy === 'sse' && (input.isStatic || serverless)) {
    warnings.push(`Strategy "sse" requires a persistent server; using polling on ${platform}.`)
    updateStrategy = 'polling'
  }
  if (updateStrategy === 'ws' && (input.isStatic || !input.websocket)) {
    warnings.push(`Strategy "ws" requires WebSocket support; using polling on ${platform}.`)
    updateStrategy = 'polling'
  }
  if (updateStrategy === 'ws' && platform !== 'node' && !(platform === 'cloudflare' && preset === 'cloudflare-durable')) {
    warnings.push(`Strategy "ws" is unavailable on ${platform}; using polling.`)
    updateStrategy = 'polling'
  }

  return {
    _tag: 'resolved',
    platform,
    mode,
    updateStrategy,
    warnings,
  }
}
