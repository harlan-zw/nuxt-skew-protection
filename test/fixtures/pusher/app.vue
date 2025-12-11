<script setup lang="ts">
import { ref } from 'vue'

const version = ref('v1')
</script>

<template>
  <div>
    <h1>Pusher Skew Protection Test</h1>
    <div>
      <p>Version: {{ version }}</p>
    </div>
    <div />
  </div>
</template>
