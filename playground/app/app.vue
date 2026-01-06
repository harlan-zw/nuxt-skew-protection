<script setup>
const { loggedIn } = useUserSession()

const navLinks = computed(() => [
  { label: 'Playground', to: '/', icon: 'i-heroicons-home' },
  { label: 'Admin', to: '/admin', icon: 'i-heroicons-chart-bar' },
  ...(!loggedIn.value ? [{ label: 'Login', to: '/login', icon: 'i-heroicons-arrow-right-on-rectangle' }] : []),
])
</script>

<template>
  <UApp>
    <div class="min-h-screen bg-gray-50 dark:bg-gray-950">
      <!-- Navigation -->
      <nav class="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div class="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div class="flex items-center gap-1">
            <NuxtLink
              v-for="link in navLinks"
              :key="link.to"
              :to="link.to"
              class="px-3 py-2 rounded-md text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              active-class="!text-primary-600 dark:!text-primary-400 bg-primary-50 dark:bg-primary-900/20"
            >
              <UIcon :name="link.icon" class="w-4 h-4 mr-1.5 inline-block" />
              {{ link.label }}
            </NuxtLink>
          </div>
          <UBadge v-if="loggedIn" color="success" variant="soft" size="xs">
            Logged in
          </UBadge>
        </div>
      </nav>

      <!-- Main Content -->
      <main class="max-w-4xl mx-auto p-8">
        <NuxtPage />
      </main>
    </div>
  </UApp>
</template>
