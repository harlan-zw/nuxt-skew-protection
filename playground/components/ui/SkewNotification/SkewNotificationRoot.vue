<script setup lang="ts">
defineEmits<{
  dismiss: []
  reload: []
}>()

// Focus management for accessibility
onMounted(() => {
  document.body.style.overflow = 'hidden'
})

onUnmounted(() => {
  document.body.style.overflow = ''
})
</script>

<template>
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="skew-notification-title"
    aria-describedby="skew-notification-description"
    :style="{
      position: 'fixed',
      inset: '0',
      zIndex: '50',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }"
    @keydown.esc="$emit('dismiss')"
  >
    <slot :dismiss="() => $emit('dismiss')" :reload="() => $emit('reload')" />
  </div>
</template>
