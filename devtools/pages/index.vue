<script lang="ts" setup>
import { computed } from '#imports'
import { hasProductionUrl, isProductionMode, productionUrl } from 'nuxtseo-layer-devtools/composables/state'
import { debugData, productionData, productionError } from '../composables/data'

const configItems = computed(() => {
  const c = debugData.value?.config
  if (!c)
    return []
  return [
    { key: 'Reload Strategy', value: c.reloadStrategy || 'disabled' },
    { key: 'Multi-Tab Sync', value: c.multiTab },
    { key: 'Connection Tracking', value: c.connectionTracking },
    { key: 'Route Tracking', value: c.routeTracking },
    { key: 'IP Tracking', value: c.ipTracking },
    { key: 'Debug', value: c.debug },
  ]
})

const cookieItems = computed(() => {
  const cookie = debugData.value?.config?.cookie as Record<string, unknown> | undefined
  if (!cookie)
    return []
  return [
    { key: 'Name', value: String(cookie.name || '__nkpv'), mono: true },
    { key: 'Max Age', value: cookie.maxAge ? `${cookie.maxAge}s` : 'Not set' },
    { key: 'Path', value: String(cookie.path || '/'), mono: true },
    { key: 'SameSite', value: String(cookie.sameSite || 'lax') },
  ]
})

const healthOk = computed(() => productionData.value?.health?.ok === true)

const healthItems = computed(() => {
  const h = productionData.value?.health
  if (!h)
    return []
  return [
    { key: 'Status', value: h.ok ? 'Healthy' : 'Unhealthy' },
    { key: 'Build ID', value: h.version, mono: true },
    { key: 'Uptime', value: formatUptime(h.uptime) },
  ]
})

const statsItems = computed(() => {
  const s = productionData.value?.stats
  if (!s)
    return []
  return [
    { key: 'Total Connections', value: s.total },
    ...Object.entries(s.versions).map(([v, count]) => ({
      key: `Version ${v.slice(0, 8)}`,
      value: count,
      mono: true,
    })),
  ]
})

function formatUptime(seconds: number): string {
  if (seconds < 60)
    return `${seconds}s`
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}
</script>

<script lang="ts">
const siteConfigSnippet = `export default defineNuxtConfig({
  site: {
    url: 'https://your-production-url.com'
  }
})`
</script>

<template>
  <div class="devtools-main-content space-y-5 p-5">
    <!-- Production mode: show live data -->
    <template v-if="isProductionMode">
      <DevtoolsAlert v-if="healthOk" variant="production" icon="carbon:cloud">
        Connected to <strong>{{ productionUrl }}</strong>
      </DevtoolsAlert>

      <DevtoolsProductionError v-if="productionError" />

      <!-- Health -->
      <DevtoolsSection v-if="productionData?.health" icon="carbon:activity" text="Health" description="Live production server status">
        <div class="flex items-center gap-3 mb-3">
          <DevtoolsMetric
            :value="productionData.health.ok ? 'Healthy' : 'Down'"
            :variant="productionData.health.ok ? 'success' : 'danger'"
            icon="carbon:circle-filled"
            label="Status"
          />
          <DevtoolsMetric
            :value="formatUptime(productionData.health.uptime)"
            variant="info"
            icon="carbon:time"
            label="Uptime"
          />
        </div>
        <DevtoolsKeyValue :items="healthItems" striped />
      </DevtoolsSection>

      <!-- Stats (if available) -->
      <DevtoolsSection v-if="productionData?.stats" icon="carbon:connection-signal" text="Active Connections" description="Real-time connection statistics">
        <div class="flex items-center gap-3 mb-3">
          <DevtoolsMetric
            :value="productionData.stats.total"
            variant="info"
            icon="carbon:user-multiple"
            label="Connected"
          />
        </div>
        <DevtoolsKeyValue :items="statsItems" striped />
      </DevtoolsSection>
    </template>

    <!-- Dev mode: show config + CTA -->
    <template v-else>
      <DevtoolsAlert variant="info" icon="carbon:information">
        Skew protection is active in production builds only. Configure your site URL to preview live data.
      </DevtoolsAlert>

      <!-- Production URL hint -->
      <div v-if="!hasProductionUrl" class="hint-callout">
        <div class="flex items-center gap-2">
          <UIcon name="carbon:cloud" class="text-lg" aria-hidden="true" />
          <span class="font-semibold">Connect to Production</span>
        </div>
        <p class="text-sm opacity-80 mt-1 mb-3">
          Add your production URL to preview live skew protection data, version history, and connection stats.
        </p>
        <DevtoolsSnippet
          label="nuxt.config.ts"
          :code="siteConfigSnippet"
          lang="js"
        />
      </div>
    </template>

    <!-- Config (always visible) -->
    <DevtoolsSection icon="carbon:settings" text="Module Configuration" description="Resolved runtime settings">
      <DevtoolsKeyValue :items="configItems" striped />
    </DevtoolsSection>

    <DevtoolsSection icon="carbon:cookie" text="Cookie" description="Version tracking cookie settings">
      <DevtoolsKeyValue :items="cookieItems" striped />
    </DevtoolsSection>
  </div>
</template>
