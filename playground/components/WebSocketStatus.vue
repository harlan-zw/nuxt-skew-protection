<script setup lang="ts">
import { useSkewProtection } from '#imports'

// Access WebSocket state from the composable
const { wsConnected, detectionReason, isOutdated } = useSkewProtection()
</script>

<template>
  <div
    :style="{
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      padding: '12px 16px',
      borderRadius: '8px',
      backgroundColor: wsConnected ? '#10b981' : '#6b7280',
      color: 'white',
      fontSize: '14px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      zIndex: '1000',
      transition: 'all 0.3s ease',
    }"
  >
    <div :style="{ fontWeight: '600', marginBottom: '4px' }">
      WebSocket: {{ wsConnected ? 'Connected' : 'Disconnected' }}
    </div>
    <div v-if="isOutdated" :style="{ fontSize: '12px', opacity: '0.9' }">
      Update detected via: {{ detectionReason }}
    </div>
  </div>
</template>
