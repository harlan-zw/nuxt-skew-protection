<script setup lang="ts">
import { SkewNotification } from '#components'

interface Props {
  open?: boolean
}

withDefaults(defineProps<Props>(), {
  open: false,
})

const toast = useToast()

// Watch for skew notifications and show toast
</script>

<template>
  <SkewNotification v-slot="{ isOpen, dismiss, reload, timeAgo }" :open="open">
    <div v-if="isOpen" class="hidden">
      <!-- Trigger toast programmatically -->
      {{ toast.add({
        id: 'skew-update',
        title: 'New update available!',
        timeout: 0,
        color: 'primary',
        actions: [{
          label: 'Refresh',
          color: 'primary',
          click: () => {
            reload()
            toast.remove('skew-update')
          },
        }, {
          label: 'Dismiss',
          color: 'gray',
          variant: 'ghost',
          click: () => {
            dismiss()
            toast.remove('skew-update')
          },
        }],
      }) && '' }}
    </div>
  </SkewNotification>
</template>
