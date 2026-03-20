<script setup>
import { reloadNuxtApp, useCookie, useNuxtApp, useRuntimeConfig } from '#app'
import { useSkewProtection, useToast } from '#imports'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const runtimeConfig = useRuntimeConfig()
const buildId = ref(runtimeConfig.app?.buildId)
const versionCookie = useCookie('__nkpv')
const skew = useSkewProtection()

async function checkForUpdates() {
  console.log('Manually checking for updates via Nuxt API...')
  console.log(await skew.getDeploymentInfo())
}

function clearVersionCookie() {
  versionCookie.value = null
  console.log('Version cookie cleared')
}

const isAnimating = ref(false)
let animationInterval = null

function startNewVersionAnimations() {
  if (isAnimating.value) {
    isAnimating.value = false
    if (animationInterval) {
      clearInterval(animationInterval)
      animationInterval = null
    }
    console.log('Stopped variant animations')
    return
  }

  isAnimating.value = true
  let currentIndex = 0

  selectedVariant.value = notificationVariants[currentIndex].value
  setTimeout(() => {
    skew.simulateUpdate()
    console.log(`Starting variant animations - showing: ${notificationVariants[currentIndex].label}`)
  }, 100)

  animationInterval = setInterval(() => {
    currentIndex = (currentIndex + 1) % notificationVariants.length
    selectedVariant.value = notificationVariants[currentIndex].value

    setTimeout(() => {
      skew.simulateUpdate()
      console.log(`Cycling to variant: ${notificationVariants[currentIndex].label}`)
    }, 100)
  }, 2000)
}

const app = useNuxtApp()
const modules = ref([])
const chunksOutdatedPayload = ref(null)

onMounted(() => {
  app.$skewServiceWorker?.getLoadedModules().then((m) => {
    modules.value = m || []
  })

  app.hooks.hook('skew:chunks-outdated', (payload) => {
    console.log('Chunks outdated detected:', payload)
    chunksOutdatedPayload.value = payload
  })
})

onBeforeUnmount(() => {
  if (animationInterval) {
    clearInterval(animationInterval)
  }
})

const latestVersion = computed(() => skew.manifest.value?.buildId)
const isNewVersionAvailable = computed(() => buildId.value !== latestVersion.value)
const versions = computed(() => skew.manifest.value?.skewProtection?.versions || {})

const notificationVariants = [
  { value: 'native', label: 'Native CSS (Default)', description: 'Custom CSS implementation' },
  { value: 'minimal', label: 'Minimal', description: 'Compact pill design' },
  { value: 'ualert', label: 'UAlert', description: 'Nuxt UI Alert component' },
  { value: 'ucard', label: 'UCard', description: 'Nuxt UI Card component' },
  { value: 'toast', label: 'Toast', description: 'Programmatic toast (useToast)' },
]

const selectedVariant = ref('native')

const toast = useToast()

watch(selectedVariant, (newVariant, oldVariant) => {
  if (oldVariant === 'toast') {
    toast.remove('skew-update')
  }

  if (newVariant === 'toast') {
    toast.add({
      id: 'skew-update',
      title: 'New update available!',
      duration: 0,
      color: 'primary',
      actions: [{
        label: 'Refresh',
        color: 'primary',
        click: async () => {
          toast.remove('skew-update')
          await reloadNuxtApp({
            force: true,
            persistState: true,
          })
        },
      }, {
        label: 'Dismiss',
        color: 'gray',
        variant: 'ghost',
        click: () => {
          toast.remove('skew-update')
        },
      }],
    })
  }
})
</script>

<template>
  <div class="space-y-6">
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-gray-900 dark:text-white">
        Nuxt Skew Protection Playground
      </h1>
      <p class="text-gray-600 dark:text-gray-400 mt-2">
        Intelligent module invalidation detection
      </p>
    </div>

    <UCard>
      <template #header>
        <h3 class="text-lg font-semibold">
          Version State
        </h3>
      </template>
      <div class="space-y-3">
        <div class="flex justify-between items-center">
          <span class="font-medium text-gray-700 dark:text-gray-300">Current Build ID:</span>
          <code class="text-sm bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">{{ buildId }}</code>
        </div>
        <div class="flex justify-between items-center">
          <span class="font-medium text-gray-700 dark:text-gray-300">Latest Build ID:</span>
          <code class="text-sm bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">{{ latestVersion || 'Unknown' }}</code>
        </div>
        <div class="flex justify-between items-center">
          <span class="font-medium text-gray-700 dark:text-gray-300">Cookie (__nkpv):</span>
          <code class="text-sm bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">{{ versionCookie || 'Not set' }}</code>
        </div>
        <div class="flex justify-between items-center">
          <span class="font-medium text-gray-700 dark:text-gray-300">New Version Available:</span>
          <UBadge :color="isNewVersionAvailable ? 'warning' : 'neutral'">
            {{ isNewVersionAvailable ? 'Yes' : 'No' }}
          </UBadge>
        </div>
        <div class="flex justify-between items-center">
          <span class="font-medium text-gray-700 dark:text-gray-300">Chunks Outdated:</span>
          <UBadge :color="skew.isAppOutdated ? 'error' : 'neutral'">
            {{ skew.isAppOutdated ? 'Yes' : 'No' }}
          </UBadge>
        </div>
      </div>
    </UCard>

    <UCard v-if="Object.keys(versions).length > 0">
      <template #header>
        <h3 class="text-lg font-semibold">
          Version Manifest
        </h3>
      </template>
      <div class="max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded p-2">
        <pre class="text-xs">{{ JSON.stringify(versions, null, 2) }}</pre>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h3 class="text-lg font-semibold">
          Notification Variant
        </h3>
      </template>
      <USelectMenu
        v-model="selectedVariant"
        :items="notificationVariants"
        value-key="value"
        class="w-full"
      >
        <template #item-label="{ item }">
          <div>
            <div class="font-medium">
              {{ item.label }}
            </div>
            <div class="text-sm text-gray-500 dark:text-gray-400">
              {{ item.description }}
            </div>
          </div>
        </template>
      </USelectMenu>
    </UCard>

    <UCard>
      <template #header>
        <h3 class="text-lg font-semibold">
          Test Actions
        </h3>
      </template>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <UButton
          variant="outline"
          color="primary"
          icon="i-heroicons-arrow-path"
          @click="checkForUpdates"
        >
          Check for Updates
        </UButton>
        <UButton
          variant="outline"
          color="warning"
          icon="i-heroicons-bolt"
          @click="skew.simulateUpdate"
        >
          Simulate Update
        </UButton>
        <UButton
          variant="outline"
          color="error"
          icon="i-heroicons-trash"
          @click="clearVersionCookie"
        >
          Clear Cookie
        </UButton>
        <UButton
          variant="solid"
          :color="isAnimating ? 'error' : 'primary'"
          :icon="isAnimating ? 'i-heroicons-stop' : 'i-heroicons-play'"
          @click="startNewVersionAnimations"
        >
          {{ isAnimating ? 'Stop' : 'Start' }} Animations
        </UButton>
      </div>
    </UCard>

    <UCard v-if="chunksOutdatedPayload">
      <template #header>
        <h3 class="text-lg font-semibold text-red-600 dark:text-red-400">
          Chunks Outdated Event
        </h3>
      </template>
      <div class="space-y-3">
        <div>
          <span class="font-medium">Deleted Chunks:</span>
          <code class="block text-xs bg-gray-100 dark:bg-gray-800 px-2 py-2 rounded mt-1">{{ chunksOutdatedPayload.deletedChunks?.length || 0 }} chunks</code>
        </div>
        <div>
          <span class="font-medium">Invalidated Modules:</span>
          <code class="block text-xs bg-gray-100 dark:bg-gray-800 px-2 py-2 rounded mt-1">{{ chunksOutdatedPayload.invalidatedModules?.join(', ') || 'None' }}</code>
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h3 class="text-lg font-semibold">
          Service Worker Tracked Modules ({{ modules.length }})
        </h3>
      </template>
      <div class="max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded">
        <ul class="space-y-1 p-2">
          <li
            v-for="module in modules"
            :key="module"
            class="text-xs font-mono text-gray-600 dark:text-gray-400 py-1 border-b border-gray-100 dark:border-gray-800 last:border-0"
          >
            {{ module }}
          </li>
        </ul>
      </div>
    </UCard>

    <!-- Skew Protection Notification Components -->
    <SkewNotificationUAlert v-if="selectedVariant === 'ualert'" />
    <SkewNotificationUCard v-else-if="selectedVariant === 'ucard'" />
    <SkewNotificationMinimal v-else-if="selectedVariant === 'minimal'" />
    <SkewNotificationNative v-else-if="selectedVariant === 'native'" />
  </div>
</template>
