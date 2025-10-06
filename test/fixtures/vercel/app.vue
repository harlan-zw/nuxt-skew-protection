<script setup lang="ts">
const config = useRuntimeConfig()
const buildId = computed(() => config.public.deploymentId)
const vercelDeployment = computed(() => config.public.deploymentId || 'local')
</script>

<template>
  <div>
    <h1>Vercel Platform Test</h1>
    <p>Build ID: {{ buildId }}</p>
    <p>Vercel Deployment: {{ vercelDeployment }}</p>
    <SkewNotification v-slot="{ isOpen, dismiss, reload }">
      <div v-if="isOpen" class="notification">
        <p>New version deployed!</p>
        <button @click="reload">
          Reload
        </button>
        <button @click="dismiss">
          Dismiss
        </button>
      </div>
    </SkewNotification>
  </div>
</template>
