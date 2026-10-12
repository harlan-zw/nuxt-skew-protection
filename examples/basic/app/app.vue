<template>
  <div>
    <NuxtPage />
    <SkewNotification v-slot="{ isCurrentChunksOutdated, dismiss, reload, timeAgo }">
      <div v-if="isCurrentChunksOutdated" role="status">
        <p>A new version is available. It was released {{ timeAgo }}.</p>
        <button type="button" @click="reload">
          Reload
        </button>
        <button type="button" @click="dismiss">
          Dismiss
        </button>
      </div>
    </SkewNotification>
  </div>
</template>
