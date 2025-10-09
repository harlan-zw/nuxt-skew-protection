<script setup lang="ts">
import type { ChunksOutdatedPayload } from '../../types'
import { reloadNuxtApp } from '#imports'
import { useTimeAgo } from '@vueuse/core'
import { computed, ref } from 'vue'
import { useSkewProtection } from '../composables/useSkewProtection'

interface Props {
  /**
   * Force the notification to be open (for testing/debugging).
   */
  forceOpen?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'dismiss': []
  'reload': []
  'update:open': [value: boolean]
  'chunksOutdated': [payload: ChunksOutdatedPayload]
}>()

const skewProtection = useSkewProtection()

// State from chunks outdated event
const chunksOutdated = ref(false)
const appOutdated = ref(false)
const outdatedPayload = ref<ChunksOutdatedPayload | null>(null)

// Listen for chunks outdated events
skewProtection.onCurrentChunksOutdated((payload) => {
  chunksOutdated.value = true
  outdatedPayload.value = payload
})

skewProtection.onAppOutdated(() => {
  appOutdated.value = true
})

// Determine if notification should be open
const isCurrentChunksOutdated = computed(() => {
  if (props.forceOpen)
    return true
  return chunksOutdated.value
})

const isAppOutdated = computed(() => {
  if (props.forceOpen)
    return true
  return appOutdated.value
})

// Get latest release date from manifest
const releaseDate = computed(() => {
  const timestamp = skewProtection.manifest.value?.timestamp
  return timestamp ? new Date(timestamp) : new Date()
})

// Reactive time ago using VueUse
const timeAgo = useTimeAgo(releaseDate, {
  showSecond: true,
})

function handleDismiss() {
  chunksOutdated.value = false
  emit('dismiss')
}

async function handleReload() {
  emit('reload')
  reloadNuxtApp({
    force: true,
    persistState: true,
  })
}
</script>

<template>
  <slot
    :is-current-chunks-outdated="isCurrentChunksOutdated"
    :dismiss="handleDismiss"
    :reload="handleReload"
    :time-ago="timeAgo"
    :release-date="releaseDate"
    :payload="outdatedPayload"
    :is-app-outdated="isAppOutdated"
  />
</template>
