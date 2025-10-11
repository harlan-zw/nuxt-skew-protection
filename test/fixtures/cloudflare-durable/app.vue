<script setup lang="ts">
const skewProtection = useSkewProtection()
</script>

<template>
  <div>
    <h1>Cloudflare Durable Objects WebSocket :)</h1>
    <p>Build ID: {{ skewProtection.clientVersion }}</p>
    <SkewNotification v-slot="{ isCurrentChunksOutdated, isAppOutdated, dismiss, reload }">
      <div class="notification">
        <div>
          current chunk outdated: {{ isCurrentChunksOutdated }}
        </div>
        <div>
          app outdated: {{ isAppOutdated }}
        </div>
        <div>
          build ID: {{ skewProtection.clientVersion }}
        </div>
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
