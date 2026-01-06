<script setup lang="ts">
import { useActiveConnections } from '#imports'

const { loggedIn, user, clear } = useUserSession()
const { total, versions, routes, connections, yourId, authorized } = useActiveConnections()

const versionList = computed(() => {
  return Object.entries(versions.value)
    .sort(([, a], [, b]) => b - a)
    .map(([id, count]) => ({
      id: id.slice(0, 8),
      fullId: id,
      count,
      percentage: total.value ? Math.round((count / total.value) * 100) : 0,
    }))
})

const routeList = computed(() => {
  return Object.entries(routes.value)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
})

async function logout() {
  await clear()
  await navigateTo('/')
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">
          Admin Dashboard
        </h1>
        <p class="text-gray-600 dark:text-gray-400 mt-1">
          Live connection statistics via useActiveConnections()
        </p>
      </div>
      <div v-if="loggedIn" class="flex items-center gap-3">
        <UBadge color="success" variant="soft">
          {{ user?.name || user?.email }}
        </UBadge>
        <UButton variant="ghost" color="neutral" @click="logout">
          Logout
        </UButton>
      </div>
    </div>

    <UAlert
      v-if="!loggedIn"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      title="Not logged in"
      description="You need to log in to view live stats. Stats are only available to authorized users."
    />

    <UAlert
      v-else-if="authorized === false"
      color="error"
      icon="i-heroicons-x-circle"
      title="Not authorized"
      description="Your session is not authorized to view stats. Check the skew:authorize-stats hook implementation."
    />

    <UAlert
      v-else-if="authorized === null"
      color="info"
      icon="i-heroicons-arrow-path"
      title="Connecting..."
      description="Waiting for stats subscription authorization."
    />

    <template v-else>
      <!-- Connections List -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold">
              Active Connections
            </h3>
            <UBadge color="primary" variant="soft">
              {{ total }}
            </UBadge>
          </div>
        </template>
        <div v-if="connections.length === 0" class="text-gray-500 text-center py-4">
          No active connections
        </div>
        <div v-else class="divide-y divide-gray-200 dark:divide-gray-700">
          <div
            v-for="conn in connections"
            :key="conn.id"
            class="flex items-center justify-between py-3"
          >
            <div class="flex items-center gap-3">
              <code class="text-xs text-gray-500">{{ conn.id.slice(0, 8) }}</code>
              <UBadge v-if="conn.id === yourId" color="success" variant="soft" size="xs">
                you
              </UBadge>
            </div>
            <div class="flex items-center gap-4 text-sm">
              <div class="text-gray-600 dark:text-gray-400">
                <span class="text-gray-400">v:</span> <code>{{ conn.version.slice(0, 8) }}</code>
              </div>
              <div class="text-gray-600 dark:text-gray-400">
                <span class="text-gray-400">route:</span> <code>{{ conn.route }}</code>
              </div>
              <div v-if="conn.ip" class="text-gray-600 dark:text-gray-400">
                <span class="text-gray-400">ip:</span> <code>{{ conn.ip }}</code>
              </div>
            </div>
          </div>
        </div>
      </UCard>

      <!-- Version Distribution -->
      <UCard>
        <template #header>
          <h3 class="text-lg font-semibold">
            Version Distribution
          </h3>
        </template>
        <div v-if="versionList.length === 0" class="text-gray-500 text-center py-4">
          No active connections
        </div>
        <div v-else class="space-y-3">
          <div v-for="v in versionList" :key="v.fullId" class="space-y-1">
            <div class="flex justify-between text-sm">
              <code class="text-gray-700 dark:text-gray-300">{{ v.id }}</code>
              <span class="text-gray-600 dark:text-gray-400">{{ v.count }} ({{ v.percentage }}%)</span>
            </div>
            <UProgress :value="v.percentage" size="sm" />
          </div>
        </div>
      </UCard>

      <!-- Active Routes -->
      <UCard>
        <template #header>
          <h3 class="text-lg font-semibold">
            Active Routes
          </h3>
        </template>
        <div v-if="routeList.length === 0" class="text-gray-500 text-center py-4">
          No route data (requires routeTracking: true)
        </div>
        <div v-else class="divide-y divide-gray-200 dark:divide-gray-700">
          <div
            v-for="[route, count] in routeList"
            :key="route"
            class="flex justify-between py-2"
          >
            <code class="text-sm text-gray-700 dark:text-gray-300">{{ route }}</code>
            <UBadge color="neutral" variant="soft">
              {{ count }} {{ count === 1 ? 'user' : 'users' }}
            </UBadge>
          </div>
        </div>
      </UCard>
    </template>

    <!-- Implementation Example -->
    <UCard>
      <template #header>
        <h3 class="text-lg font-semibold">
          Implementation
        </h3>
      </template>
      <div class="space-y-4">
        <div>
          <h4 class="font-medium mb-2">
            1. Authorization Hook (server/plugins/skew-auth.ts)
          </h4>
          <pre class="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-x-auto"><code>export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('skew:authorize-stats', async ({ event, authorize }) => {
    const session = await getUserSession(event)
    if (session.user?.role === 'admin') {
      authorize()
    }
  })
})</code></pre>
        </div>
        <div>
          <h4 class="font-medium mb-2">
            2. Usage in Component
          </h4>
          <pre class="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-x-auto"><code>const { total, versions, routes, authorized } = useActiveConnections()</code></pre>
        </div>
      </div>
    </UCard>
  </div>
</template>
