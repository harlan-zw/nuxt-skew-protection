<script setup lang="ts">
import type { ChunksOutdatedPayload } from '../../types'
import { useTimeAgo } from '@vueuse/core'
import { reloadNuxtApp } from 'nuxt/app'
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
const dismissed = ref(false)

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
  if (dismissed.value)
    return false
  if (props.forceOpen)
    return true
  return chunksOutdated.value
})

const isAppOutdated = computed(() => {
  if (dismissed.value)
    return false
  if (props.forceOpen)
    return true
  return appOutdated.value
})

// Get latest release date from manifest
const releaseTimestamp = computed(() => {
  if (props.forceOpen)
    return Date.now() - 5 * 60 * 1000 // Mock: 5 minutes ago
  return skewProtection.manifest.value?.timestamp ?? Date.now()
})
const releaseDate = computed(() => new Date(releaseTimestamp.value))

// Reactive time ago using VueUse
const timeAgo = useTimeAgo(releaseTimestamp, {
  showSecond: true,
})

function handleDismiss() {
  dismissed.value = true
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
const shouldRender = import.meta.client && !import.meta.prerender
</script>

<template>
  <slot
    v-if="shouldRender"
    :is-current-chunks-outdated="isCurrentChunksOutdated"
    :dismiss="handleDismiss"
    :reload="handleReload"
    :time-ago="timeAgo"
    :release-date="releaseDate"
    :payload="outdatedPayload"
    :is-app-outdated="isAppOutdated"
  />
</template>
