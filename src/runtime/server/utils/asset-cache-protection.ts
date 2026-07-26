function withTrailingSlash(value: string) {
  const path = `/${value.replace(/^\/+|\/+$/g, '')}`
  return `${path}/`
}

export function shouldDisableAssetErrorCaching(
  path: string,
  status: number,
  buildAssetsDir: string,
) {
  return status >= 400 && path.startsWith(withTrailingSlash(buildAssetsDir))
}
