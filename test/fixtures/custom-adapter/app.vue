<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useNuxtApp } from '#app'

const endpoint = ref('')

onMounted(() => {
  useNuxtApp().$skewConnection?.connect()
  endpoint.value = (globalThis as any).__CUSTOM_ADAPTER_ENDPOINT__ || ''
})
</script>

<template>
  <output data-testid="adapter-endpoint">{{ endpoint }}</output>
</template>
