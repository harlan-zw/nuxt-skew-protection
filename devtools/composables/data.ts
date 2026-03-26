import type { DebugResponse, ProductionDebugResponse } from './types'
import { computed, ref, useAsyncData, watch } from '#imports'
import { appFetch } from 'nuxtseo-layer-devtools/composables/rpc'
import { isProductionMode, productionUrl, refreshTime } from 'nuxtseo-layer-devtools/composables/state'

export const productionData = ref<ProductionDebugResponse | null>(null)
export const productionError = ref<string | null>(null)

const { data: debugData, status: debugStatus } = useAsyncData<DebugResponse | null>('debug', () => {
  if (!appFetch.value)
    return Promise.resolve(null)
  return appFetch.value<DebugResponse>('/__skew-devtools/debug').catch(() => null)
}, { watch: [refreshTime] })

export { debugData }

export const isLoading = computed(() => debugStatus.value === 'pending')
export const moduleVersion = computed(() => debugData.value?.version || 'unknown')
export const siteUrl = computed(() => debugData.value?.siteConfigUrl || '')

// Sync production URL from site config when debug data changes
watch(debugData, (data) => {
  if (data?.siteConfigUrl) {
    productionUrl.value = data.siteConfigUrl
  }
})

export async function fetchProductionData() {
  if (!appFetch.value || !isProductionMode.value)
    return
  productionError.value = null
  const url = productionUrl.value
  productionData.value = await appFetch.value<ProductionDebugResponse>('/__skew-devtools/debug-production', {
    query: { url },
  }).catch((err) => {
    productionError.value = err.message || 'Failed to connect to production'
    return null
  })
}

export async function refreshAll() {
  await refreshNuxtData('debug')
  if (isProductionMode.value) {
    await fetchProductionData()
  }
}
