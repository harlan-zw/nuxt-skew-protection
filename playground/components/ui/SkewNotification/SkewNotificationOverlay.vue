<script setup lang="ts">
defineEmits<{
  dismiss: []
}>()
</script>

<template>
  <div
    :style="{
      position: 'fixed',
      inset: '0',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      zIndex: '-1',
    }"
    @click="$emit('dismiss')"
  />
</template>
