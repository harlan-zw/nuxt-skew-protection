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
const outdatedPayload = ref<ChunksOutdatedPayload | null>(null)

// Listen for chunks outdated events
skewProtection.onChunksOutdated((payload) => {
  chunksOutdated.value = true
  outdatedPayload.value = payload
  emit('chunksOutdated', payload)
})

// Determine if notification should be open
const isOpen = computed(() => {
  if (props.forceOpen)
    return true
  return chunksOutdated.value
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

// Number of releases that passed
const releaseCount = computed(() => {
  return outdatedPayload.value?.passedReleases.length ?? 0
})

// Number of invalidated modules
const invalidatedCount = computed(() => {
  return outdatedPayload.value?.invalidatedModules.length ?? 0
})

function handleDismiss() {
  chunksOutdated.value = false
  outdatedPayload.value = null
  emit('update:open', false)
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
    :is-open="isOpen"
    :dismiss="handleDismiss"
    :reload="handleReload"
    :time-ago="timeAgo"
    :release-date="releaseDate"
    :release-count="releaseCount"
    :invalidated-count="invalidatedCount"
    :payload="outdatedPayload"
  />
</template>
