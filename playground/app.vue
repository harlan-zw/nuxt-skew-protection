<script setup>
import { reloadNuxtApp, useCookie, useNuxtApp, useRuntimeConfig } from '#app'
import { useSkewProtection, useToast } from '#imports'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const runtimeConfig = useRuntimeConfig()
const buildId = ref(runtimeConfig.app?.buildId)
const versionCookie = useCookie('skew-version')
const skew = useSkewProtection()

async function checkForUpdates() {
  console.log('Manually checking for updates via Nuxt API...')
  console.log(await skew.getDeploymentInfo())
}

async function checkVersionStatus() {
  console.log('Checking version status via our API...')
  // if ($skewProtection.value?.checkVersionStatus) {
  //   const status = await $skewProtection.value.checkVersionStatus()
  //   console.log('Version status:', status)
  // }
}

function clearVersionCookie() {
  if (versionCookie.value) {
    versionCookie.value.value = null
  }
  console.log('Version cookie cleared')
}

const isAnimating = ref(false)
let animationInterval = null

function startNewVersionAnimations() {
  if (isAnimating.value) {
    // Stop animation
    isAnimating.value = false
    if (animationInterval) {
      clearInterval(animationInterval)
      animationInterval = null
    }
    console.log('Stopped variant animations')
    return
  }

  // Start animation
  isAnimating.value = true
  let currentIndex = 0

  // Set initial variant and simulate update after a small delay
  selectedVariant.value = notificationVariants[currentIndex].value
  setTimeout(() => {
    skew.simulateUpdate()
    console.log(`Starting variant animations - showing: ${notificationVariants[currentIndex].label}`)
  }, 100)

  animationInterval = setInterval(() => {
    currentIndex = (currentIndex + 1) % notificationVariants.length
    selectedVariant.value = notificationVariants[currentIndex].value

    // Add delay to allow component to unmount/remount before simulating update
    setTimeout(() => {
      skew.simulateUpdate()
      console.log(`Cycling to variant: ${notificationVariants[currentIndex].label}`)
    }, 100)
  }, 2000)
}

const app = useNuxtApp()
const modules = ref([])
onMounted(async () => {
  modules.value = await app.$skewServiceWorker?.getLoadedModules() || []
})

onBeforeUnmount(() => {
  if (animationInterval) {
    clearInterval(animationInterval)
  }
})

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
            Test and preview different notification variants
          </p>
        </div>

        <UCard>
          <template #header>
            <h3 class="text-lg font-semibold">
              Current Version Info
            </h3>
          </template>
          <div class="space-y-2">
            <div class="flex justify-between">
              <span class="font-medium text-gray-700 dark:text-gray-300">Build ID:</span>
              <code class="text-sm bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">{{ buildId }}</code>
            </div>
            <div class="flex justify-between">
              <span class="font-medium text-gray-700 dark:text-gray-300">Version Cookie:</span>
              <code class="text-sm bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">{{ versionCookie?.value || 'Not set' }}</code>
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
              color="blue"
              icon="i-heroicons-check-circle"
              @click="checkVersionStatus"
            >
              Check Version Status
            </UButton>
            <UButton
              variant="outline"
              color="red"
              icon="i-heroicons-trash"
              @click="clearVersionCookie"
            >
              Clear Version Cookie
            </UButton>
            <UButton
              variant="solid"
              :color="isAnimating ? 'red' : 'primary'"
              :icon="isAnimating ? 'i-heroicons-stop' : 'i-heroicons-play'"
              @click="startNewVersionAnimations"
            >
              {{ isAnimating ? 'Stop Animations' : 'Start Animations' }}
            </UButton>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <h3 class="text-lg font-semibold">
              Loaded Modules ({{ modules.length }})
            </h3>
          </template>
          <div class="max-h-96 overflow-y-auto">
            <ul class="space-y-1">
              <li
                v-for="module in modules"
                :key="module"
                class="text-sm font-mono text-gray-600 dark:text-gray-400 py-1 border-b border-gray-100 dark:border-gray-800 last:border-0"
              >
                {{ module }}
              </li>
            </ul>
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
    <SkewNotification v-else-if="selectedVariant === 'native'" v-slot="{ isOpen, dismiss, reload, timeAgo }">
      <Transition name="slide-up">
        <div
          v-if="isOpen"
          class="skew-notification"
        >
          <div class="skew-notification-content">
            <div class="skew-notification-message">
              <span class="skew-notification-icon">✨</span>
              <div>
                <div class="skew-notification-title">
                  New update available!
                </div>
                <div v-if="timeAgo" class="skew-notification-subtitle">
                  Released {{ timeAgo }}
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
