<script setup lang="ts">
defineEmits<{
  reload: []
}>()
</script>

<template>
  <button
    type="button"
    :style="{
      backgroundColor: '#3b82f6',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      padding: '0.5rem 1rem',
      fontSize: '0.875rem',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'background-color 0.2s',
    }"
    @click="$emit('reload')"
    @mouseenter="$event.target.style.backgroundColor = '#2563eb'"
    @mouseleave="$event.target.style.backgroundColor = '#3b82f6'"
  >
    <slot />
  </button>
</template>
