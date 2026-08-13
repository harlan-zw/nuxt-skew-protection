export type CloudflareWorkerFirst = boolean | Array<string | undefined> | undefined

export function withCloudflareBuildAssetRouting(
  current: CloudflareWorkerFirst,
  buildAssetsDir: string,
): Exclude<CloudflareWorkerFirst, undefined> {
  if (current === true)
    return true

  const prefix = `/${buildAssetsDir.replace(/^\/+|\/+$/g, '')}/`
  const pattern = `${prefix}*`
  const routes = Array.isArray(current) ? current.filter(route => typeof route === 'string') : []

  return routes.includes(pattern) ? routes : [...routes, pattern]
}
