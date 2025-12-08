<script setup lang="ts">
import { computed, ref } from 'vue'

const version = ref('v1')

// Add some unique code to ensure this page gets its own chunk
const aboutData = computed(() => ({
  title: 'About Page',
  version: version.value,
  timestamp: Date.now(),
}))
</script>

<template>
  <div>
    <h1 data-testid="version">
      About {{ version }}
    </h1>
    <p>{{ aboutData.title }}</p>
    <NuxtLink to="/" data-testid="home-link">
      Go to Home
    </NuxtLink>
  </div>
</template>
