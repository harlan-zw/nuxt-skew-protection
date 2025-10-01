<script setup>
import { onMounted, ref, useRuntimeConfig } from '#imports'

const config = useRuntimeConfig()

// Build information
const deploymentId = ref(config.public?.deploymentId || 'unknown')
const buildId = ref(config.public?.buildId || 'unknown')
const version = ref('1.0.0-test')
const timestamp = ref(new Date().toISOString())

// Environment information
const provider = ref('Cloudflare Workers')
const platform = ref(process.env.CF_WORKER_NAME ? 'Cloudflare' : 'Development')
const workerName = ref(process.env.CF_WORKER_NAME || 'local')
const previewDomain = ref(process.env.CF_PREVIEW_DOMAIN || 'localhost')

// Request information
const currentUrl = ref('')
const requestHeaders = ref('')
const testResult = ref('')

// Deployment mapping
const deploymentMapping = ref('')

onMounted(() => {
  currentUrl.value = window.location.href

  // Get request headers (simplified for display)
  requestHeaders.value = JSON.stringify({
    'user-agent': navigator.userAgent,
    'x-deployment-id': getDeploymentIdFromRequest(),
  }, null, 2)

  // Try to get deployment mapping from API
  fetchDeploymentMapping()
})

function getDeploymentIdFromRequest() {
  const url = new URL(window.location.href)
  return url.searchParams.get('dpl') || 'none'
}

async function fetchDeploymentMapping() {
  try {
    const response = await $fetch('/api/_skew/deployment-mapping')
    deploymentMapping.value = JSON.stringify(response, null, 2)
  }
  catch (error) {
    deploymentMapping.value = `Error: ${error.message}`
  }
}

async function testCurrentVersion() {
  testResult.value = 'Testing current version...'
  try {
    const response = await $fetch('/_skew/status')
    testResult.value = JSON.stringify(response, null, 2)
  }
  catch (error) {
    testResult.value = `Error: ${error.message}`
  }
}

async function testOldVersion() {
  testResult.value = 'Testing old version routing...'
  try {
    // Make request with old deployment ID header
    const response = await $fetch('/_skew/status', {
      headers: {
        'x-deployment-id': 'dpl-test-old',
      },
    })
    testResult.value = JSON.stringify(response, null, 2)
  }
  catch (error) {
    testResult.value = `Error: ${error.message}`
  }
}

function testQueryParam() {
  // Navigate with query parameter
  const url = new URL(window.location.href)
  url.searchParams.set('dpl', 'dpl-test-old')
  window.location.href = url.toString()
}
</script>

<template>
  <div class="container">
    <h1>🛡️ Nuxt Skew Protection - Cloudflare Test</h1>

    <div class="info-grid">
      <div class="info-card">
        <h3>🔧 Build Information</h3>
        <p><strong>Deployment ID:</strong> {{ deploymentId }}</p>
        <p><strong>Build ID:</strong> {{ buildId }}</p>
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
        <button class="btn-primary" @click="testCurrentVersion">
          Test Current Version
        </button>
        <button class="btn-secondary" @click="testOldVersion">
          Test Old Version (dpl-test-old)
        </button>
        <button class="btn-secondary" @click="testQueryParam">
          Test Query Parameter
        </button>
      </div>

      <div v-if="testResult" class="test-result">
        <h4>Test Result:</h4>
        <pre>{{ testResult }}</pre>
      </div>
    </div>

    <div class="deployment-mapping">
      <h3>📋 Deployment Mapping</h3>
      <pre>{{ deploymentMapping }}</pre>
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

.deployment-mapping {
  background: #f1f3f4;
  border-radius: 8px;
  padding: 1rem;
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
