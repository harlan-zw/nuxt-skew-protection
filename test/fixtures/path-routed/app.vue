<script setup lang="ts">
import { ref } from 'vue'

const version = ref('v1')
</script>

<template>
  <div>
    <h1>Path-routed Skew Protection Test</h1>
    <p>Version: {{ version }}</p>
  </div>
</template>
