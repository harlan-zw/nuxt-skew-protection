import { useNuxtApp } from '#app'
// @ts-expect-error virtual file
import { buildAssetsURL } from '#internal/nuxt/paths'

export async function fetchLatestManifest() {
  const nuxtApp = useNuxtApp()
  if (nuxtApp._manifestFetch) {
    return nuxtApp._manifestFetch
  }
  // eslint-disable-next-line no-async-promise-executor
  return nuxtApp._manifestFetch = new Promise(async (resolve) => {
    const meta = await $fetch(`${buildAssetsURL('builds/latest.json')}?${Date.now()}`)
    if (nuxtApp.$skewProtection && meta.id !== nuxtApp.$skewProtection.currentVersion) {
      // will propegate to the app via the hook above
      await nuxtApp.hooks.callHook('app:manifest:update', meta)
    }
    resolve(meta)
  }).finally(() => {
    nuxtApp._manifestFetch = null
  })
}
