<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, watch } from 'vue'
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

// Determine if notification should be open
const isOpen = computed(() => {
  if (props.auto && skewProtection) {
    // In auto mode, sync with version tracker state
    return skewProtection.isOutdated.value
  }
  // In manual mode, use the prop
  return props.open
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

// Provide state to child components
provide('skewNotification', {
  isOpen,
  dismiss: handleDismiss,
  reload: handleReload,
  // Expose composable data to children
  ...(skewProtection && {
    newVersion: skewProtection.newVersion,
    currentVersion: skewProtection.currentVersion,
    getVersionsBehind: skewProtection.getVersionsBehind,
    getReleaseDate: skewProtection.getReleaseDate,
    getDeploymentInfo: skewProtection.getDeploymentInfo,
  }),
})

// Focus management and body scroll lock for accessibility
onMounted(() => {
  if (isOpen.value) {
    document.body.style.overflow = 'hidden'
  }
})

onUnmounted(() => {
  document.body.style.overflow = ''
})

watch(isOpen, (value) => {
  if (value) {
    document.body.style.overflow = 'hidden'
  }
  else {
    document.body.style.overflow = ''
  }
})
</script>

<template>
  <div
    v-if="isOpen"
    role="dialog"
    aria-modal="true"
    aria-labelledby="skew-notification-title"
    aria-describedby="skew-notification-description"
    @keydown.esc="handleDismiss"
  >
    <slot
      :is-open="isOpen"
      :dismiss="handleDismiss"
      :reload="handleReload"
      :new-version="skewProtection?.newVersion.value"
      :current-version="skewProtection?.currentVersion.value"
      :get-versions-behind="skewProtection?.getVersionsBehind"
      :get-release-date="skewProtection?.getReleaseDate"
      :get-deployment-info="skewProtection?.getDeploymentInfo"
    />
  </div>
</template>
