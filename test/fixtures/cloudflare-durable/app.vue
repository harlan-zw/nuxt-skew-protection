<script setup lang="ts">
const config = useRuntimeConfig()
const buildId = computed(() => config.public.deploymentId)
</script>

<template>
  <div>
    <h1>Cloudflare Durable Objects WebSocket Test</h1>
    <p>Build ID: {{ buildId }}</p>
    <SkewNotification v-slot="{ isOpen, dismiss, reload }">
      <div v-if="isOpen" class="notification">
        <p>New version available!</p>
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
