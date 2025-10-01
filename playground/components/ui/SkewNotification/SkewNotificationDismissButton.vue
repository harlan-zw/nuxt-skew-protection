<script setup lang="ts">
defineEmits<{
  dismiss: []
}>()
</script>

<template>
  <button
    type="button"
    :style="{
      backgroundColor: '#f9fafb',
      color: '#374151',
      border: '1px solid #d1d5db',
      borderRadius: '6px',
      padding: '0.5rem 1rem',
      fontSize: '0.875rem',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'background-color 0.2s',
    }"
    @click="$emit('dismiss')"
    @mouseenter="$event.target.style.backgroundColor = '#f3f4f6'"
    @mouseleave="$event.target.style.backgroundColor = '#f9fafb'"
  >
    <slot />
  </button>
</template>
