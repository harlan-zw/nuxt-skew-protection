<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSkewProtection } from '../composables/useSkewProtection'

interface Props {
  open?: boolean
}

withDefaults(defineProps<Props>(), {
  open: false,
  auto: true,
})

const emit = defineEmits<{
  'dismiss': []
  'reload': []
  'update:open': [value: boolean]
}>()

// Use the composable if auto mode is enabled
const skewProtection = useSkewProtection()

// Track if modules have been invalidated
const modulesInvalidated = ref(false)
const releaseDate = ref<Date | null>(null)

// Listen for module invalidation events
skewProtection.onCurrentModulesInvalidated(async () => {
  modulesInvalidated.value = true
  // Fetch release date when new version is detected
  // if (skewProtection.newVersion.value) {
  //   releaseDate.value = await skewProtection.getReleaseDate(skewProtection.newVersion.value)
  // }
})

// Determine if notification should be open
const isOpen = computed(() => {
  // In auto mode, show when modules are invalidated
  return modulesInvalidated.value
})

// Calculate time ago
const timeAgo = computed(() => {
  if (!releaseDate.value)
    return null

  const now = new Date()
  const diff = now.getTime() - releaseDate.value.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0)
    return `${days} day${days > 1 ? 's' : ''} ago`
  if (hours > 0)
    return `${hours} hour${hours > 1 ? 's' : ''} ago`
  if (minutes > 0)
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  return 'just now'
})

function handleDismiss() {
  emit('update:open', false)
  emit('dismiss')
}

function handleReload() {
  emit('reload')
}
</script>

<template>
  <slot
    :is-open="isOpen"
    :dismiss="handleDismiss"
    :reload="handleReload"
    :time-ago="timeAgo"
    :release-date="releaseDate"
  />
</template>
