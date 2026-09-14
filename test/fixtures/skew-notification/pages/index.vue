<script setup lang="ts">
import { ref } from 'vue'

const version = ref('v1')
const showNotification = ref(true)
</script>

<template>
  <div>
    <h1 data-testid="version">
      App {{ version }}
    </h1>

    <button data-testid="toggle-notification" @click="showNotification = !showNotification">
      Toggle notification
    </button>
    <SkewNotification v-if="showNotification" v-slot="{ isCurrentChunksOutdated, isAppOutdated, reload, dismiss, timeAgo }">
      <div
        v-if="isCurrentChunksOutdated || isAppOutdated"
        data-testid="skew-notification"
        class="notification"
      >
        <p data-testid="notification-message">
          A new version is available ({{ timeAgo }})
        </p>
        <button data-testid="reload-btn" @click="reload">
          Reload
        </button>
        <button data-testid="dismiss-btn" @click="dismiss">
          Dismiss
        </button>
      </div>
    </SkewNotification>
  </div>
</template>

<style scoped>
.notification {
  position: fixed;
  bottom: 20px;
  right: 20px;
  padding: 16px;
  background: #333;
  color: white;
  border-radius: 8px;
}
</style>
