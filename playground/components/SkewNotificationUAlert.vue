<script setup lang="ts">
import { SkewNotification } from '#components'

interface Props {
  open?: boolean
}

withDefaults(defineProps<Props>(), {
  open: false,
})
</script>

<template>
  <SkewNotification v-slot="{ isCurrentChunksOutdated, dismiss, reload, timeAgo }" :open="open">
    <Transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-200 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div
        v-if="isCurrentChunksOutdated"
        class="fixed bottom-4 right-4 z-50 max-w-md"
      >
        <UAlert
          color="primary"
          variant="soft"
          title="New update available!"
          :description="timeAgo ? `Released ${timeAgo}` : 'Refresh to get the latest version'"
          :close-button="{ icon: 'i-heroicons-x-mark-20-solid', color: 'gray', variant: 'link', padded: false }"
          @close="dismiss"
        >
          <template #icon>
            <span class="text-lg">✨</span>
          </template>
          <template #actions>
            <UButton
              color="primary"
              variant="solid"
              label="Refresh"
              @click="reload"
            />
          </template>
        </UAlert>
      </div>
    </Transition>
  </SkewNotification>
</template>
