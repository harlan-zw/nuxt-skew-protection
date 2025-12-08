<script setup lang="ts">
import { ref } from 'vue'

const version = ref('v1')
</script>

<template>
  <div>
    <h1 data-testid="version">
      Home {{ version }}
    </h1>
    <NuxtLink to="/about" data-testid="about-link" :prefetch="false">
      Go to About
    </NuxtLink>
  </div>
</template>
