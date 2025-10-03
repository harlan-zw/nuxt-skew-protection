<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSkewProtection } from '../../composables/useSkewProtection'

interface Props {
  open?: boolean
  auto?: boolean // Automatically sync with version tracker
}

const props = withDefaults(defineProps<Props>(), {
  open: false,
  auto: true,
})

const emit = defineEmits<{
  'dismiss': []
  'reload': []
  'update:open': [value: boolean]
}>()

// Use the composable if auto mode is enabled
const skewProtection = props.auto ? useSkewProtection() : null

// Track if modules have been invalidated
const modulesInvalidated = ref(false)
const releaseDate = ref<Date | null>(null)

// Listen for module invalidation events
if (props.auto && skewProtection) {
  skewProtection.onCurrentModulesInvalidated(async () => {
    console.log('Modules invalidated, setting flag to true')
    modulesInvalidated.value = true
    // Fetch release date when new version is detected
    if (skewProtection.newVersion.value) {
      releaseDate.value = await skewProtection.getReleaseDate(skewProtection.newVersion.value)
    }
  })
}

// Determine if notification should be open
const isOpen = computed(() => {
  if (props.auto && skewProtection) {
    // In auto mode, show when modules are invalidated
    return modulesInvalidated.value
  }
  // In manual mode, use the prop
  return props.open
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

// Watch for manual prop changes (only in manual mode)
watch(() => props.open, (value) => {
  if (!props.auto) {
    emit('update:open', value)
  }
})

function handleDismiss() {
  if (props.auto && skewProtection) {
    // In auto mode, dismiss the version mismatch state
    skewProtection.dismiss()
  }
  emit('update:open', false)
  emit('dismiss')
}

function handleReload() {
  if (props.auto && skewProtection) {
    // In auto mode, use the composable's update and reload
    skewProtection.updateAndReload()
  }
  emit('reload')
}
</script>

<template>
  <slot
    :is-open="isOpen"
    :dismiss="handleDismiss"
    :reload="handleReload"
    :time-ago="timeAgo"
    :new-version="skewProtection?.newVersion.value"
    :current-version="skewProtection?.currentVersion.value"
    :release-date="releaseDate"
    :get-versions-behind="skewProtection?.getVersionsBehind"
    :get-release-date="skewProtection?.getReleaseDate"
    :get-deployment-info="skewProtection?.getDeploymentInfo"
  />
</template>
