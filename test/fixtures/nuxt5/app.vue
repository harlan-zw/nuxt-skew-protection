<script setup lang="ts">
import { useRuntimeConfigSkewProtection } from '#skew-protection/app'
import { createSkewConnection } from '#skew-protection/app/utils/create-skew-connection'

const cookieEnabled = useRuntimeConfigSkewProtection().cookie !== false

let connectionCount = 0
const connection = createSkewConnection({
  name: 'packed-consumer',
  setup: () => { connectionCount++ },
})
connection.connect()
</script>

<template>
  <main>
    Nuxt Skew Protection Nitro 3
    <p id="alias-app">
      {{ cookieEnabled }}
    </p>
    <p id="connection-count">
      {{ connectionCount }}
    </p>
  </main>
</template>
