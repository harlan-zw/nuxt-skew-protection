<script setup lang="ts">
import { ref } from 'vue'

const version = ref('v5')
</script>

<template>
  <div>
    <h1>Static Site Skew Protection Test</h1>
    <div>
      <p>Version: {{ version }}</p>
    </div>
  </div>
</template>
