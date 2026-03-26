<script lang="ts" setup>
import type { VersionInfo } from '../composables/types'
import { computed } from '#imports'
import { isProductionMode } from 'nuxtseo-layer-devtools/composables/state'
import { productionData, productionError } from '../composables/data'

const versions = computed(() => {
  const skew = productionData.value?.manifest?.skewProtection
  if (!skew?.versions)
    return []
  return Object.entries(skew.versions as Record<string, VersionInfo>)
    .map(([id, info]) => ({
      id,
      shortId: id.slice(0, 8),
      timestamp: new Date(info.timestamp),
      expires: new Date(info.expires),
      assetCount: info.assets?.length || 0,
      deletedChunks: info.deletedChunks?.length || 0,
      isExpired: new Date(info.expires).getTime() < Date.now(),
    }))
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
})

const currentBuildId = computed(() => {
  const id = productionData.value?.manifest?.id
  return typeof id === 'string' ? id : null
})

function formatDate(date: Date): string {
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'narrow' })

function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60)
    return rtf.format(-seconds, 'second')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60)
    return rtf.format(-minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24)
    return rtf.format(-hours, 'hour')
  const days = Math.floor(hours / 24)
  return rtf.format(-days, 'day')
}
</script>

<template>
  <div class="devtools-main-content space-y-5 p-5">
    <template v-if="isProductionMode">
      <DevtoolsProductionError v-if="productionError" />

      <DevtoolsAlert v-if="currentBuildId" variant="success" icon="carbon:checkmark-outline">
        Current build: <code class="font-mono ml-1">{{ currentBuildId.slice(0, 8) }}</code>
      </DevtoolsAlert>

      <DevtoolsEmptyState
        v-if="!versions.length && !productionError"
        icon="carbon:version"
        title="No Version History"
        description="No skew protection version data found in the build manifest. Make sure bundleAssets is enabled."
      />

      <!-- Version timeline -->
      <DevtoolsPanel
        v-for="v in versions"
        :key="v.id"
        :title="v.shortId"
        icon="carbon:version"
      >
        <template #header>
          <div class="flex items-center gap-2">
            <code class="text-sm font-mono font-semibold">{{ v.shortId }}</code>
            <DevtoolsMetric
              v-if="v.id === currentBuildId"
              value="current"
              variant="success"
            />
            <DevtoolsMetric
              v-else-if="v.isExpired"
              value="expired"
              variant="danger"
            />
          </div>
          <span class="text-xs opacity-60">{{ formatRelative(v.timestamp) }}</span>
        </template>

        <DevtoolsKeyValue
          :items="[
            { key: 'Built', value: formatDate(v.timestamp) },
            { key: 'Expires', value: formatDate(v.expires) },
            { key: 'Assets', value: v.assetCount },
            { key: 'Deleted Chunks', value: v.deletedChunks },
          ]"
          striped
        />
      </DevtoolsPanel>
    </template>

    <!-- Dev mode empty state -->
    <template v-else>
      <div class="flex items-center justify-center min-h-[400px]">
        <DevtoolsEmptyState
          icon="carbon:version"
          title="Version History"
          description="Switch to production mode to view your deployment version history, asset tracking, and chunk lifecycle."
        />
      </div>
    </template>
  </div>
</template>
