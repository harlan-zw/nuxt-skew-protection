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
  <SkewNotification v-slot="{ isOpen, dismiss, reload }" :open="open">
    <Transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-200 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div
        v-if="isOpen"
        class="fixed bottom-4 right-4 z-50"
      >
        <div class="flex items-center gap-3 bg-white dark:bg-gray-900 rounded-full shadow-lg ring-1 ring-gray-200 dark:ring-gray-800 px-4 py-3">
          <span class="text-lg">✨</span>
          <div class="text-sm font-medium text-gray-900 dark:text-white">
            Update available
          </div>
          <UButton
            color="primary"
            size="xs"
            label="Refresh"
            class="cursor-pointer"
            @click="reload"
          />
          <UButton
            color="gray"
            variant="ghost"
            size="xs"
            icon="i-heroicons-x-mark-20-solid"
            class="cursor-pointer"
            @click="dismiss"
          />
        </div>
      </div>
    </Transition>
  </SkewNotification>
</template>
