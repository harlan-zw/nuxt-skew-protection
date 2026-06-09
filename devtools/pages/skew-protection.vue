<script lang="ts" setup>
import { isProductionMode } from 'nuxtseo-layer-devtools/composables/state'
import { ref } from 'vue'
import { useRoute, watch } from '#imports'
import { fetchProductionData, isLoading, moduleVersion, refreshAll } from '../lib/skew-protection/data'
import '../lib/skew-protection/rpc'

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
  if (p === '/skew-protection/versions')
    activeTab.value = 'versions'
  else if (p === '/skew-protection/connections')
    activeTab.value = 'connections'
  else if (p === '/skew-protection/docs')
    activeTab.value = 'docs'
  else
    activeTab.value = 'overview'
}, { immediate: true })

const navItems = [
  { value: 'overview', to: '/skew-protection', icon: 'carbon:dashboard', label: 'Overview' },
  { value: 'versions', to: '/skew-protection/versions', icon: 'carbon:version', label: 'Versions' },
  { value: 'connections', to: '/skew-protection/connections', icon: 'carbon:connection-signal', label: 'Connections', devOnly: true },
  { value: 'docs', to: '/skew-protection/docs', icon: 'carbon:book', label: 'Docs' },
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
