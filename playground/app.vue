<script setup>
import { useCookie, useNuxtApp, useRuntimeConfig } from '#app'
import { useSkewProtection } from '#imports'
import { onMounted, ref } from 'vue'

const runtimeConfig = useRuntimeConfig()
const buildId = ref(runtimeConfig.app?.buildId)
const versionCookie = useCookie('skew-version')
const $skewProtection = ref(null)
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

function simulateNewVersion() {
  // Simulate a version mismatch by setting a different cookie value
  if (versionCookie.value) {
    versionCookie.value.value = 'old-version-123'
  }
  console.log('Simulated old version in cookie, next check should trigger notification')
}

const app = useNuxtApp()
const modules = ref([])
onMounted(async () => {
  modules.value = await app.$skewServiceWorker.getLoadedModules()
})
</script>

<template>
  <div>
    <div style="padding: 2rem; max-width: 800px; margin: 0 auto;">
      <h1>Nuxt Skew Protection Playgroundxx :3</h1>
      <p>This playground demonstrates the skew protection module functionality.</p>

      <div style="background: #f5f5f5; padding: 1rem; border-radius: 8px; margin: 1rem 0;">
        <h3>Current Version Info</h3>
        <p><strong>Build ID:</strong> {{ buildId }}</p>
        <p><strong>Version Cookie:</strong> {{ versionCookie?.value || 'Not set' }}</p>
      </div>

      <div style="background: #e8f5e8; padding: 1rem; border-radius: 8px; margin: 1rem 0;">
        <h3>Test Actions</h3>
        <button style="margin: 0.5rem; padding: 0.5rem 1rem;" @click="checkForUpdates">
          Check for Updates (Nuxt API)
        </button>
        <button style="margin: 0.5rem; padding: 0.5rem 1rem;" @click="checkVersionStatus">
          Check Version Status (Our API)
        </button>
        <button style="margin: 0.5rem; padding: 0.5rem 1rem;" @click="clearVersionCookie">
          Clear Version Cookie
        </button>
        <button style="margin: 0.5rem; padding: 0.5rem 1rem;" @click="simulateNewVersion">
          Simulate New Version
        </button>
      </div>

      <div class="foo" style="background: #fff3cd; padding: 1rem; border-radius: 8px; margin: 1rem 0;">
        <h3>Loaded Modules</h3>
        <div style="max-height: 400px; overflow-y: auto;">
          <ul>
            <li v-for="module in modules" :key="module">
              {{ module }}
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Skew Protection Notification Component -->
    <SkewNotificationRoot v-slot="{ isOpen, dismiss, reload, timeAgo }">
      <div>
        debug: {{ isOpen ? 'open' : 'closed' }}
      </div>
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
                <div class="skew-notification-subtitle">
                  {{ timeAgo || 'Just now' }}
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
    </SkewNotificationRoot>
  </div>
</template>

<style>
.foo {
  color: green;
}

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
