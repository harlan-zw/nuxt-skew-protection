import { defineEventHandler } from 'h3'
import { useRuntimeConfig, useStorage } from 'nitropack/runtime'
import { getSkewProtectionCookie } from '../../composables/cookie'

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig(event)
  const currentBuildId = runtimeConfig.app.buildId
  const userVersion = getSkewProtectionCookie(event)
  const storage = useStorage('skew-protection')

  const manifest = await storage.getItem('versions-manifest.json').catch(() => null) as any

  return {
    currentBuildId,
    userVersion,
    outdated: currentBuildId !== userVersion,
    manifest,
    // clientVersion: userVersion,
    // currentVersion: manifest?.current,
    // versionExists: !!versionInfo,
    // versionExpires: versionInfo?.expires,
    // availableVersions: Object.keys(manifest?.versions),
  }
})
