import { getRequestPath, getResponseStatus, setResponseHeader } from 'h3'
import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'
import { shouldDisableAssetErrorCaching } from '../utils/asset-cache-protection'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event) => {
    const buildAssetsDir = useRuntimeConfig(event).app.buildAssetsDir

    if (shouldDisableAssetErrorCaching(getRequestPath(event), getResponseStatus(event), buildAssetsDir)) {
      setResponseHeader(event, 'cache-control', 'no-store')
    }
  })
})
