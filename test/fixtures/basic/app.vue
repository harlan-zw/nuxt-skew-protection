<script setup>
const buildId = process.env.NUXT_BUILD_ID || 'test-build'
const currentTime = new Date().toISOString()
</script>

<template>
  <div>
    <h1>Skew Protection Test App</h1>
    <div>
      <p>Build ID: {{ buildId }}</p>
      <p>Current Time: {{ currentTime }}</p>
    </div>
  </div>
</template>
