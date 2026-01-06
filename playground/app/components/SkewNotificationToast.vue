<script setup>
const toast = useToast()

function showToast(reload, dismiss) {
  toast.add({
    id: 'skew-update',
    title: 'Update available',
    description: 'A new version is ready',
    icon: 'i-heroicons-sparkles',
    color: 'primary',
    duration: 0,
    actions: [{
      label: 'Refresh',
      click: () => {
        toast.remove('skew-update')
        reload()
      },
    }, {
      label: 'Dismiss',
      color: 'neutral',
      variant: 'ghost',
      click: () => {
        toast.remove('skew-update')
        dismiss()
      },
    }],
  })
}
</script>

<template>
  <SkewNotification v-slot="{ isCurrentChunksOutdated, dismiss, reload }">
    <template v-if="isCurrentChunksOutdated">
      {{ showToast(reload, dismiss) }}
    </template>
  </SkewNotification>
</template>
