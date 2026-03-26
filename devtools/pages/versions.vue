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
      isExpired: new Date(info.expires) < new Date(),
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
      <div v-for="v in versions" :key="v.id" class="version-card" :class="{ 'version-current': v.id === currentBuildId }">
        <div class="version-header">
          <div class="flex items-center gap-2">
            <div class="version-dot" :class="v.id === currentBuildId ? 'version-dot-current' : v.isExpired ? 'version-dot-expired' : 'version-dot-active'" />
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
        </div>

        <div class="version-details">
          <DevtoolsKeyValue
            :items="[
              { key: 'Built', value: formatDate(v.timestamp) },
              { key: 'Expires', value: formatDate(v.expires) },
              { key: 'Assets', value: v.assetCount },
              { key: 'Deleted Chunks', value: v.deletedChunks },
            ]"
            striped
          />
        </div>
      </div>
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

<style scoped>
.version-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface-elevated);
  overflow: hidden;
  transition: border-color 200ms ease;
}

.version-card:hover {
  border-color: var(--color-neutral-300);
}

.dark .version-card:hover {
  border-color: var(--color-neutral-700);
}

.version-current {
  border-color: oklch(65% 0.15 145 / 0.4);
}

.dark .version-current {
  border-color: oklch(65% 0.15 145 / 0.3);
}

.version-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1rem;
  border-bottom: 1px solid var(--color-border-subtle);
}

.version-details {
  padding: 0;
}

.version-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.version-dot-current {
  background: oklch(65% 0.2 145);
  box-shadow: 0 0 6px oklch(65% 0.2 145 / 0.5);
}

.version-dot-active {
  background: oklch(65% 0.1 230);
}

.version-dot-expired {
  background: oklch(55% 0.1 25);
  opacity: 0.5;
}
</style>
