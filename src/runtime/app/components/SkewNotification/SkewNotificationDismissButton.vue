<script setup lang="ts">
import { inject } from 'vue'

const skewNotification = inject<{
  isOpen: Ref<boolean>
  dismiss: () => void
  reload: () => void
}>('skewNotification')

if (!skewNotification) {
  throw new Error('SkewNotificationDismissButton must be used within SkewNotificationRoot')
}

const { dismiss } = skewNotification
</script>

<template>
  <button
    type="button"
    @click="dismiss"
  >
    <slot :dismiss="dismiss" />
  </button>
</template>
