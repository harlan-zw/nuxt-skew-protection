<script setup lang="ts">
import { useSkewProtection } from '#imports'

const skewProtection = useSkewProtection()
</script>

<template>
  <main>
    <h1 data-testid="default-page">
      Default update notification
    </h1>
    <button type="button" @click="skewProtection.simulateUpdate">
      Simulate update
    </button>
  </main>
</template>
