<script setup>
import { reloadNuxtApp, useCookie, useNuxtApp, useRuntimeConfig } from '#app'
import { useSkewProtection, useToast } from '#imports'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const runtimeConfig = useRuntimeConfig()
const buildId = ref(runtimeConfig.app?.buildId)
const versionCookie = useCookie('__nkpv') // Correct cookie name per ARCHITECTURE.md
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

onMounted(async () => {
  modules.value = await app.$skewServiceWorker?.getLoadedModules() || []

  // Listen to skew-protection:chunks-outdated hook (per ARCHITECTURE.md)
  app.hooks.hook('skew-protection:chunks-outdated', (payload) => {
    console.log('🚨 Chunks outdated detected:', payload)
    chunksOutdatedPayload.value = payload
  })
})

onBeforeUnmount(() => {
  if (animationInterval) {
    clearInterval(animationInterval)
  }
})

// Computed values to show architecture state
const latestVersion = computed(() => skew.manifest.value?.buildId)
const isNewVersionAvailable = computed(() => buildId.value !== latestVersion.value)
const versions = computed(() => skew.manifest.value?.skewProtection?.versions || {})

// Notification variant configuration
const notificationVariants = [
  { value: 'native', label: 'Native CSS (Default)', description: 'Custom CSS implementation' },
  { value: 'minimal', label: 'Minimal', description: 'Compact pill design' },
  { value: 'ualert', label: 'UAlert', description: 'Nuxt UI Alert component' },
  { value: 'ucard', label: 'UCard', description: 'Nuxt UI Card component' },
  { value: 'toast', label: 'Toast', description: 'Programmatic toast (useToast)' },
]

const selectedVariant = ref('native')

// Toast notification handling
const toast = useToast()

watch(selectedVariant, (newVariant, oldVariant) => {
  // Remove toast when switching away from toast variant
  if (oldVariant === 'toast') {
    toast.remove('skew-update')
  }

  // Add toast when switching to toast variant
  if (newVariant === 'toast') {
    toast.add({
      id: 'skew-update',
      title: 'New update available!',
      duration: 0, // Persistent toast
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
  <UApp>
    <div class="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div class="max-w-4xl mx-auto p-8 space-y-6">
        <div class="text-center mb-8">
          <h1 class="text-3xl font-bold text-gray-900 dark:text-white">
            Nuxt Skew Protection Playground
          </h1>
          <p class="text-gray-600 dark:text-gray-400 mt-2">
            Intelligent module invalidation detection
          </p>
          <p class="text-sm text-gray-500 dark:text-gray-500 mt-1 max-w-2xl mx-auto">
            Notifications only appear when your <strong>loaded JS modules</strong> are deleted by a new deployment.
            Service worker tracks modules, checks against deletedChunks, fires <code class="text-xs">skew-protection:chunks-outdated</code> hook.
          </p>
        </div>

        <UCard>
          <template #header>
            <h3 class="text-lg font-semibold">
              Version State (per ARCHITECTURE.md)
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
              <UBadge :color="isNewVersionAvailable ? 'yellow' : 'gray'">
                {{ isNewVersionAvailable ? 'Yes' : 'No' }}
              </UBadge>
            </div>
            <div class="flex justify-between items-center">
              <span class="font-medium text-gray-700 dark:text-gray-300">Chunks Outdated:</span>
              <UBadge :color="skew.isOutdated ? 'red' : 'gray'">
                {{ skew.isOutdated ? 'Yes' : 'No' }}
              </UBadge>
            </div>
            <div class="pt-2 border-t border-gray-200 dark:border-gray-700">
              <p class="text-xs text-gray-500 dark:text-gray-400">
                ℹ️ <strong>New Version Available</strong> = new deployment detected<br>
                ℹ️ <strong>Chunks Outdated</strong> = your loaded modules were deleted (notification triggers)
              </p>
            </div>
          </div>
        </UCard>

        <UCard v-if="Object.keys(versions).length > 0">
          <template #header>
            <h3 class="text-lg font-semibold">
              Version Manifest (skewProtection.versions)
            </h3>
          </template>
          <div class="space-y-2">
            <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">
              From <code>builds/latest.json</code> - tracks all retained versions with assets and deletedChunks
            </p>
            <div class="max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded p-2">
              <pre class="text-xs">{{ JSON.stringify(versions, null, 2) }}</pre>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <h3 class="text-lg font-semibold">
              Notification Variant
            </h3>
          </template>
          <div class="space-y-2">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Choose Notification Style
            </label>
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
          </div>
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
              color="orange"
              icon="i-heroicons-bolt"
              @click="skew.simulateUpdate"
            >
              Simulate Update
            </UButton>
            <UButton
              variant="outline"
              color="red"
              icon="i-heroicons-trash"
              @click="clearVersionCookie"
            >
              Clear Cookie
            </UButton>
            <UButton
              variant="solid"
              :color="isAnimating ? 'red' : 'primary'"
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
              🚨 Chunks Outdated Event (skew-protection:chunks-outdated hook)
            </h3>
          </template>
          <div class="space-y-3">
            <div>
              <span class="font-medium text-gray-700 dark:text-gray-300">Deleted Chunks:</span>
              <code class="block text-xs bg-gray-100 dark:bg-gray-800 px-2 py-2 rounded mt-1">{{ chunksOutdatedPayload.deletedChunks?.length || 0 }} chunks</code>
            </div>
            <div>
              <span class="font-medium text-gray-700 dark:text-gray-300">Invalidated Modules:</span>
              <code class="block text-xs bg-gray-100 dark:bg-gray-800 px-2 py-2 rounded mt-1">{{ chunksOutdatedPayload.invalidatedModules?.join(', ') || 'None' }}</code>
            </div>
            <div>
              <span class="font-medium text-gray-700 dark:text-gray-300">Passed Releases:</span>
              <code class="block text-xs bg-gray-100 dark:bg-gray-800 px-2 py-2 rounded mt-1">{{ chunksOutdatedPayload.passedReleases?.length || 0 }} releases</code>
            </div>
            <div class="pt-2 border-t border-gray-200 dark:border-gray-700">
              <p class="text-xs text-gray-500 dark:text-gray-400">
                This event fires when your loaded JS modules are detected in deletedChunks. This is when the notification should appear.
              </p>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <h3 class="text-lg font-semibold">
              Service Worker Tracked Modules ({{ modules.length }})
            </h3>
          </template>
          <div class="space-y-2">
            <p class="text-xs text-gray-500 dark:text-gray-400">
              Service worker (<code>/sw.js</code>) intercepts JS fetches and tracks loaded modules.
              When new deployment detected, checks if any loaded modules are in <code>deletedChunks</code>.
            </p>
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
          </div>
        </UCard>
      </div>
    </div>

    <!-- Skew Protection Notification Components -->
    <!-- UAlert Variant -->
    <SkewNotificationUAlert v-if="selectedVariant === 'ualert'" />

    <!-- UCard Variant -->
    <SkewNotificationUCard v-else-if="selectedVariant === 'ucard'" />

    <!-- Minimal Variant -->
    <SkewNotificationMinimal v-else-if="selectedVariant === 'minimal'" />

    <!-- Toast variant is handled via useToast in script section -->

    <!-- Native CSS Variant (default) -->
    <SkewNotification v-else-if="selectedVariant === 'native'" v-slot="{ isCurrentChunksOutdated, dismiss, reload, timeAgo, invalidatedCount }">
      <Transition name="slide-up">
        <div
          v-if="isCurrentChunksOutdated"
          class="skew-notification"
        >
          <div class="skew-notification-content">
            <div class="skew-notification-message">
              <span class="skew-notification-icon">🚨</span>
              <div>
                <div class="skew-notification-title">
                  Update required
                </div>
                <div class="skew-notification-subtitle">
                  {{ invalidatedCount }} loaded module{{ invalidatedCount !== 1 ? 's' : '' }} invalidated
                  <span v-if="timeAgo">{{ timeAgo }}</span>
                </div>
              </div>
            </div>
            <div class="skew-notification-actions">
              <button class="skew-notification-button skew-notification-button-secondary" @click="dismiss">
                Dismiss
              </button>
              <button class="skew-notification-button skew-notification-button-primary" @click="reload">
                Refresh
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </SkewNotification>
  </UApp>
</template>

<style>
.skew-notification {
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  z-index: 9999;
  max-width: 400px;
  pointer-events: auto;
}

.skew-notification-content {
  background: white;
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1), 0 4px 12px rgba(0, 0, 0, 0.08);
  padding: 1rem 1.25rem;
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.skew-notification-message {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.skew-notification-icon {
  font-size: 1.5rem;
  line-height: 1;
  flex-shrink: 0;
}

.skew-notification-title {
  font-weight: 600;
  font-size: 0.9375rem;
  color: #1a1a1a;
  margin-bottom: 0.25rem;
}

.skew-notification-subtitle {
  font-size: 0.8125rem;
  color: #666;
}

.skew-notification-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

.skew-notification-button {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
}

.skew-notification-button-primary {
  background: #18181b;
  color: white;
}

.skew-notification-button-primary:hover {
  background: #27272a;
}

.skew-notification-button-secondary {
  background: #f4f4f5;
  color: #52525b;
}

.skew-notification-button-secondary:hover {
  background: #e4e4e7;
}

/* Transition animations */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-up-enter-from {
  opacity: 0;
  transform: translateY(1rem);
}

.slide-up-leave-to {
  opacity: 0;
  transform: translateY(0.5rem);
}
</style>
