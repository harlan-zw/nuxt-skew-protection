<script lang="ts" setup>
import { computed } from '#imports'
import { isProductionMode } from 'nuxtseo-layer-devtools/composables/state'
import { debugData, productionData, productionError } from '../composables/data'

const connectionTrackingEnabled = computed(() => debugData.value?.config?.connectionTracking === true)

const stats = computed(() => productionData.value?.stats)

const versionRows = computed(() => {
  if (!stats.value?.versions)
    return []
  return Object.entries(stats.value.versions)
    .map(([version, count]) => ({
      key: version.slice(0, 8),
      value: count,
      mono: true,
    }))
    .sort((a, b) => (b.value as number) - (a.value as number))
})

const routeRows = computed(() => {
  if (!stats.value?.routes)
    return []
  return Object.entries(stats.value.routes)
    .map(([route, count]) => ({
      key: route,
      value: count,
      mono: true,
    }))
    .sort((a, b) => (b.value as number) - (a.value as number))
})
</script>

<script lang="ts">
const connectionTrackingSnippet = `export default defineNuxtConfig({
  skewProtection: {
    connectionTracking: true,
    routeTracking: true
  }
})`
</script>

<template>
  <div class="devtools-main-content space-y-5 p-5">
    <template v-if="isProductionMode">
      <DevtoolsProductionError v-if="productionError" />

      <!-- Connection tracking not enabled -->
      <template v-if="!connectionTrackingEnabled">
        <DevtoolsAlert variant="warning" icon="carbon:warning">
          Connection tracking is not enabled. Enable it to see live connection data.
        </DevtoolsAlert>
        <DevtoolsEmptyState
          icon="carbon:connection-signal"
          title="Enable Connection Tracking"
          description="Add connectionTracking to your skewProtection config to monitor active users, version distribution, and route activity."
        >
          <DevtoolsSnippet
            label="nuxt.config.ts"
            :code="connectionTrackingSnippet"
            lang="js"
          />
        </DevtoolsEmptyState>
      </template>

      <!-- Has connection tracking but no stats yet -->
      <template v-else-if="!stats">
        <DevtoolsEmptyState
          icon="carbon:connection-signal"
          title="No Connection Data"
          description="Connection tracking is enabled but no stats are available yet. The endpoint may require authorization via the skew:authorize-stats hook."
        />
      </template>

      <!-- Live stats -->
      <template v-else>
        <div class="flex items-center gap-3 flex-wrap">
          <DevtoolsMetric
            :value="stats.total"
            variant="info"
            icon="carbon:user-multiple"
            label="Active Connections"
          />
          <DevtoolsMetric
            :value="Object.keys(stats.versions).length"
            variant="default"
            icon="carbon:version"
            label="Active Versions"
          />
        </div>

        <DevtoolsSection
          v-if="versionRows.length"
          icon="carbon:version"
          text="Version Distribution"
          description="Users per build version"
        >
          <DevtoolsKeyValue :items="versionRows" striped />
        </DevtoolsSection>

        <DevtoolsSection
          v-if="routeRows.length"
          icon="carbon:map"
          text="Route Distribution"
          description="Users per page route"
        >
          <DevtoolsKeyValue :items="routeRows" striped />
        </DevtoolsSection>
      </template>
    </template>

    <!-- Dev mode: not shown (devOnly: true hides the tab), but just in case -->
    <template v-else>
      <div class="flex items-center justify-center min-h-[400px]">
        <DevtoolsEmptyState
          icon="carbon:connection-signal"
          title="Live Connections"
          description="Switch to production mode to monitor active user connections, version distribution, and route activity."
        />
      </div>
    </template>
  </div>
</template>
