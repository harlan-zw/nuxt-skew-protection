<script lang="ts" setup>
import { computed, useRoute, watch } from '#imports'
import { isProductionMode } from 'nuxtseo-layer-devtools/composables/state'
import { debugData, fetchProductionData, isLoading, moduleVersion, refreshAll } from './composables/data'
import './composables/rpc'

const route = useRoute()

// Fetch production data when production mode changes
watch(isProductionMode, async (isProd) => {
  if (isProd) {
    await fetchProductionData()
  }
}, { immediate: true })

const activeTab = ref('overview')

// Sync tab from route
watch(() => route.path, (p) => {
  if (p === '/versions')
    activeTab.value = 'versions'
  else if (p === '/connections')
    activeTab.value = 'connections'
  else if (p === '/docs')
    activeTab.value = 'docs'
  else
    activeTab.value = 'overview'
}, { immediate: true })

const navItems = [
  { value: 'overview', to: '/', icon: 'carbon:dashboard', label: 'Overview' },
  { value: 'versions', to: '/versions', icon: 'carbon:version', label: 'Versions' },
  { value: 'connections', to: '/connections', icon: 'carbon:connection-signal', label: 'Connections', devOnly: true },
  { value: 'docs', to: '/docs', icon: 'carbon:book', label: 'Docs' },
]
</script>

<template>
  <DevtoolsLayout
    v-model:active-tab="activeTab"
    module-name="nuxt-skew-protection"
    title="Skew Protection"
    icon="carbon:version"
    :version="moduleVersion"
    :nav-items="navItems"
    github-url="https://github.com/harlan-zw/nuxt-skew-protection"
    :loading="isLoading"
    @refresh="refreshAll"
  >
    <NuxtPage />
  </DevtoolsLayout>
</template>
