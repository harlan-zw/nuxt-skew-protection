<template>
  <SkewNotification v-slot="{ isCurrentChunksOutdated, dismiss, reload }">
    <Transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      leave-active-class="transition duration-200 ease-in"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div v-if="isCurrentChunksOutdated" class="fixed bottom-4 right-4 z-50">
        <div class="flex items-center gap-3 bg-white dark:bg-gray-900 rounded-full shadow-lg ring-1 ring-gray-200 dark:ring-gray-800 pl-4 pr-2 py-2">
          <span class="text-sm">✨</span>
          <span class="text-sm font-medium text-gray-900 dark:text-white">Update available</span>
          <UButton color="primary" size="xs" @click="reload">
            Refresh
          </UButton>
          <UButton color="neutral" variant="ghost" size="xs" icon="i-heroicons-x-mark-20-solid" @click="dismiss" />
        </div>
      </div>
    </Transition>
  </SkewNotification>
</template>
