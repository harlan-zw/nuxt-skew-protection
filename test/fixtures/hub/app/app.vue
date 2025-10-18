<script setup>
import { onMounted, ref, useCookie, useRuntimeConfig, useSkewProtection } from '#imports'

const config = useRuntimeConfig()
const skew = useSkewProtection()

const deploymentId = ref(config.public?.deploymentId || 'unknown')
const buildId = ref(config.app?.buildId || 'unknown')
const versionCookie = useCookie('__nkpv')
const version = ref('v1')
const timestamp = ref(new Date().toISOString())

const provider = ref('NuxtHub')
const platform = ref(process.env.CF_WORKER_NAME ? 'Cloudflare (NuxtHub)' : 'Development')
const workerName = ref(process.env.CF_WORKER_NAME || 'local')
const previewDomain = ref(process.env.CF_PREVIEW_DOMAIN || 'localhost')

const currentUrl = ref('')
const requestHeaders = ref('')
const testResult = ref('')

onMounted(() => {
  currentUrl.value = window.location.href

  requestHeaders.value = JSON.stringify({
    'user-agent': navigator.userAgent,
    'cookie': document.cookie,
  }, null, 2)
})

async function testManifest() {
  testResult.value = 'Fetching manifest...'
  try {
    await skew.checkForUpdates()
    testResult.value = JSON.stringify({
      currentVersion: skew.clientVersion,
      manifest: skew.manifest.value,
      isOutdated: skew.isOutdated.value,
    }, null, 2)
  }
  catch (error) {
    testResult.value = `Error: ${error.message}`
  }
}

async function simulateUpdate() {
  testResult.value = 'Simulating update...'
  await skew.simulateUpdate()
  testResult.value = 'Update simulated - check console and notification'
}
</script>

<template>
  <div class="container">
    <h1>🛡️ Nuxt Skew Protection - NuxtHub Test</h1>
    <p class="version">
      Version: {{ version }}
    </p>

    <div class="info-grid">
      <div class="info-card">
        <h3>🔧 Build Information</h3>
        <p><strong>Deployment ID:</strong> {{ deploymentId }}</p>
        <p><strong>Build ID:</strong> {{ buildId }}</p>
        <p><strong>Cookie (__nkpv):</strong> {{ versionCookie }}</p>
        <p><strong>Version:</strong> {{ version }}</p>
        <p><strong>Timestamp:</strong> {{ timestamp }}</p>
      </div>

      <div class="info-card">
        <h3>🌐 Environment</h3>
        <p><strong>Provider:</strong> {{ provider }}</p>
        <p><strong>Platform:</strong> {{ platform }}</p>
        <p><strong>Worker Name:</strong> {{ workerName }}</p>
        <p><strong>Preview Domain:</strong> {{ previewDomain }}</p>
      </div>

      <div class="info-card">
        <h3>🔄 Request Information</h3>
        <p><strong>URL:</strong> {{ currentUrl }}</p>
        <p><strong>Headers:</strong></p>
        <pre>{{ requestHeaders }}</pre>
      </div>
    </div>

    <div class="test-section">
      <h3>🧪 Test Skew Protection</h3>
      <div class="test-buttons">
        <button class="btn-primary" @click="testManifest">
          Check Manifest
        </button>
        <button class="btn-secondary" @click="simulateUpdate">
          Simulate Update
        </button>
      </div>

      <div v-if="testResult" class="test-result">
        <h4>Test Result:</h4>
        <pre>{{ testResult }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
  font-family: system-ui, sans-serif;
}

h1 {
  text-align: center;
  color: #2c3e50;
  margin-bottom: 2rem;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

.info-card {
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 1rem;
}

.info-card h3 {
  margin-top: 0;
  color: #495057;
}

.info-card p {
  margin: 0.5rem 0;
}

.info-card strong {
  color: #212529;
}

.test-section {
  background: #e3f2fd;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 2rem;
}

.test-buttons {
  display: flex;
  gap: 1rem;
  margin: 1rem 0;
  flex-wrap: wrap;
}

.btn-primary, .btn-secondary {
  padding: 0.75rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
}

.btn-primary {
  background: #007bff;
  color: white;
}

.btn-secondary {
  background: #6c757d;
  color: white;
}

.btn-primary:hover {
  background: #0056b3;
}

.btn-secondary:hover {
  background: #545b62;
}

.test-result {
  background: white;
  border: 1px solid #ccc;
  border-radius: 4px;
  padding: 1rem;
  margin-top: 1rem;
}

pre {
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  padding: 0.75rem;
  overflow-x: auto;
  font-size: 0.875rem;
  white-space: pre-wrap;
}
</style>
