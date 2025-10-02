<script setup lang="ts">
import { ref } from 'vue'

const version = ref('v2')
</script>

<template>
  <div>
    <h1>Node.js Skew Protection Test</h1>
    <div>
      <p>Version: {{ version }}</p>
    </div>
  </div>
</template>
