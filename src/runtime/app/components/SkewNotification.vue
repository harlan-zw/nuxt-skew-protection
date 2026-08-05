<script setup lang="ts">
import { useTimeAgo } from '@vueuse/core'
import { reloadNuxtApp, useNuxtApp } from 'nuxt/app'
import { computed, ref, watch } from 'vue'
import { useSkewProtection } from '../composables/useSkewProtection'

interface Props {
  /**
   * Force the notification to be open (for testing/debugging).
   */
  forceOpen?: boolean
}

defineOptions({
  inheritAttrs: false,
})

const { forceOpen = false } = defineProps<Props>()

const emit = defineEmits<{
  'dismiss': []
  'reload': []
  'update:open': [value: boolean]
}>()

const skewProtection = useSkewProtection()

const isPrerendered = !!useNuxtApp().payload.prerenderedAt

const version = skewProtection.clientVersion
const isOnline = skewProtection.isOnline

const dismissed = ref(false)

const isAppOutdated = computed(() => {
  if (!isOnline.value)
    return false
  if (dismissed.value)
    return false
  if (forceOpen)
    return true
  return skewProtection.isAppOutdated.value
})

const isOpen = computed(() => isAppOutdated.value)

watch(() => skewProtection.manifest.value?.id, () => {
  dismissed.value = false
})
watch(isOpen, value => emit('update:open', value), { immediate: true })

// Get latest release date from manifest
/* eslint-disable harlanzw/nuxt-no-unsafe-date -- client-only notification, no SSR hydration concern */
const releaseTimestamp = computed(() => {
  if (forceOpen)
    return Date.now() - 5 * 60 * 1000 // Mock: 5 minutes ago
  return skewProtection.manifest.value?.timestamp ?? Date.now()
})
/* eslint-enable harlanzw/nuxt-no-unsafe-date */
const releaseDate = computed(() => new Date(releaseTimestamp.value))

// Reactive time ago using VueUse
const timeAgo = useTimeAgo(releaseTimestamp, {
  showSecond: true,
})

function handleDismiss() {
  dismissed.value = true
  emit('dismiss')
}

async function handleReload() {
  emit('reload')
  reloadNuxtApp({
    force: true,
  })
}
</script>

<template>
  <ClientOnly>
    <slot
      :version="version"
      :is-prerendered="isPrerendered"
      :is-app-outdated="isAppOutdated"
      :is-open="isOpen"
      :dismiss="handleDismiss"
      :reload="handleReload"
      :time-ago="timeAgo"
      :release-date="releaseDate"
    />
  </ClientOnly>
</template>
