<script lang="ts" setup>
import { computed, watch } from '#imports'
import { appFetch } from 'nuxtseo-layer-devtools/composables/rpc'
import { isProductionMode, productionUrl, refreshTime } from 'nuxtseo-layer-devtools/composables/state'
import { debugData, fetchDebugData, fetchProductionData, isLoading, moduleVersion, productionData, productionError, refreshAll } from './composables/data'

const route = useRoute()

// Fetch debug data when connected
watch([appFetch, refreshTime], async () => {
  await fetchDebugData()
  // Sync production URL from site config
  if (debugData.value?.siteConfigUrl) {
    productionUrl.value = debugData.value.siteConfigUrl
  }
}, { immediate: true })

// Fetch production data when production mode changes
watch(isProductionMode, async (isProd) => {
  if (isProd) {
    await fetchProductionData()
  }
}, { immediate: true })

const currentTab = computed(() => {
  const p = route.path
  if (p === '/versions')
    return 'versions'
  if (p === '/connections')
    return 'connections'
  if (p === '/docs')
    return 'docs'
  return 'overview'
})

const navItems = [
  { value: 'overview', to: '/', icon: 'carbon:dashboard', label: 'Overview' },
  { value: 'versions', to: '/versions', icon: 'carbon:version', label: 'Versions' },
  { value: 'connections', to: '/connections', icon: 'carbon:connection-signal', label: 'Connections', devOnly: true },
  { value: 'docs', to: '/docs', icon: 'carbon:book', label: 'Docs' },
]
</script>

<template>
  <DevtoolsLayout
    module-name="nuxt-skew-protection"
    title="Skew Protection"
    icon="carbon:version"
    :version="moduleVersion"
    :nav-items="navItems"
    github-url="https://github.com/harlan-zw/nuxt-skew-protection"
    :loading="isLoading"
    :active-tab="currentTab"
    @refresh="refreshAll"
  >
    <NuxtPage />
  </DevtoolsLayout>
</template>
