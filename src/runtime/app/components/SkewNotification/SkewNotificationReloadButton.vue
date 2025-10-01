<script setup lang="ts">
import { inject } from 'vue'

const skewNotification = inject<{
  isOpen: Ref<boolean>
  dismiss: () => void
  reload: () => void
}>('skewNotification')

if (!skewNotification) {
  throw new Error('SkewNotificationReloadButton must be used within SkewNotificationRoot')
}

const { reload } = skewNotification
</script>

<template>
  <button
    type="button"
    @click="reload"
  >
    <slot :reload="reload" />
  </button>
</template>
