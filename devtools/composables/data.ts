import type { DebugResponse, ProductionDebugResponse } from './types'
import { appFetch } from 'nuxtseo-layer-devtools/composables/rpc'
import { isProductionMode, productionUrl } from 'nuxtseo-layer-devtools/composables/state'
import { computed, ref } from 'vue'

export const debugData = ref<DebugResponse | null>(null)
export const productionData = ref<ProductionDebugResponse | null>(null)
export const productionError = ref<string | null>(null)
export const isLoading = ref(false)

export const moduleVersion = computed(() => debugData.value?.version || 'unknown')
export const siteUrl = computed(() => debugData.value?.siteConfigUrl || '')

export async function fetchDebugData() {
  if (!appFetch.value)
    return
  isLoading.value = true
  debugData.value = await appFetch.value<DebugResponse>('/__skew-devtools/debug').catch(() => null)
  isLoading.value = false
}

export async function fetchProductionData() {
  if (!appFetch.value || !isProductionMode.value)
    return
  productionError.value = null
  isLoading.value = true
  const url = productionUrl.value
  productionData.value = await appFetch.value<ProductionDebugResponse>('/__skew-devtools/debug-production', {
    query: { url },
  }).catch((err) => {
    productionError.value = err.message || 'Failed to connect to production'
    return null
  })
  isLoading.value = false
}

export async function refreshAll() {
  await fetchDebugData()
  if (isProductionMode.value) {
    await fetchProductionData()
  }
}
