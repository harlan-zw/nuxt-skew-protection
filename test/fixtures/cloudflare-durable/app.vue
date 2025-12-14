<script setup lang="ts">
const skewProtection = useSkewProtection()
const { total, versions } = useActiveConnections()
</script>

<template>
  <div>
    <h1>Cloudflare Durable Objects WebSocket :)</h1>
    <p>Build ID: {{ skewProtection.clientVersion }}</p>
    <p>Active users: {{ total }}</p>
    <ul>
      <li v-for="(count, version) in versions" :key="version">
        {{ version.slice(0, 8) }}: {{ count }} users
      </li>
    </ul>
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
