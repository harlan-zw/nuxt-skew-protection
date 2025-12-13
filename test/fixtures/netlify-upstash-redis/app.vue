<script setup lang="ts">
const skew = useSkewProtection()
</script>

<template>
  <div>
    <h1>Netlify + Upstash Redis Test</h1>
    <p>Build ID: {{ skew.clientVersion }}</p>
    <SkewNotification v-slot="{ isCurrentChunksOutdated, dismiss, reload }">
      <div v-if="isCurrentChunksOutdated" class="notification">
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
