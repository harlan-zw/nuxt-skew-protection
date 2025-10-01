<script setup>
import { onMounted, ref } from 'vue'

const buildId = ref('test-build-id')
const versionCookie = ref(null)
const $skewProtection = ref(null)

onMounted(() => {
  // Access Nuxt APIs only on client side
  try {
    const runtimeConfig = useRuntimeConfig()
    buildId.value = runtimeConfig.app?.buildId || 'unknown'

    const { $skewProtection: skewProtection } = useNuxtApp()
    $skewProtection.value = skewProtection

    versionCookie.value = useCookie('skew-version')
  }
  catch (error) {
    console.warn('Could not access Nuxt APIs:', error)
  }
})

async function checkForUpdates() {
  console.log('Manually checking for updates via Nuxt API...')
  if ($skewProtection.value?.checkForUpdates) {
    await $skewProtection.value.checkForUpdates()
  }
}

async function checkVersionStatus() {
  console.log('Checking version status via our API...')
  if ($skewProtection.value?.checkVersionStatus) {
    const status = await $skewProtection.value.checkVersionStatus()
    console.log('Version status:', status)
  }
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
</script>

<template>
  <div>
    <NuxtWelcome />
    <div style="padding: 2rem; max-width: 800px; margin: 0 auto;">
      <h1>Nuxt Skew Protection Playground</h1>
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

      <div style="background: #fff3cd; padding: 1rem; border-radius: 8px; margin: 1rem 0;">
        <h3>Instructions</h3>
        <ol>
          <li>Build the module with <code>pnpm build</code></li>
          <li>Start the playground with <code>pnpm dev</code></li>
          <li>Open browser dev tools to see console logs</li>
          <li>Try the test actions above to simulate version changes</li>
          <li>Version checking happens every 10 seconds automatically</li>
        </ol>
      </div>
    </div>

    <!-- Skew Protection Notification Component -->
    <SkewProtectionNotification />
  </div>
</template>
