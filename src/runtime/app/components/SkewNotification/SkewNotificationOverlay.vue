<script setup lang="ts">
import { inject } from 'vue'

const skewNotification = inject<{
  isOpen: Ref<boolean>
  dismiss: () => void
  reload: () => void
}>('skewNotification')

if (!skewNotification) {
  throw new Error('SkewNotificationOverlay must be used within SkewNotificationRoot')
}

const { dismiss } = skewNotification
</script>

<template>
  <div @click="dismiss">
    <slot :dismiss="dismiss" />
  </div>
</template>
