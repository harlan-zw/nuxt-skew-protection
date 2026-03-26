<script setup lang="ts">
import { ref } from 'vue'

const version = ref('v1')
</script>

<template>
  <div>
    <h1 data-testid="version">
      Prerendered {{ version }}
    </h1>

    <SkewNotification v-slot="{ isCurrentChunksOutdated, isAppOutdated, isPrerendered, reload, dismiss, timeAgo }">
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
      <div data-testid="prerender-status" :data-prerendered="isPrerendered" />
    </SkewNotification>
  </div>
</template>
