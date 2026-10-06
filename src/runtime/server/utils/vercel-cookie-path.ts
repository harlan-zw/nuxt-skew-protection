export function resolveVercelCookiePath(config?: unknown): string {
  if (typeof config !== 'object' || config === null || !('vercelCookiePath' in config))
    return '/'
  return typeof config.vercelCookiePath === 'string' && config.vercelCookiePath ? config.vercelCookiePath : '/'
}
