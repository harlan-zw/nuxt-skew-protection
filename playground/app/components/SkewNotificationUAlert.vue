<template>
  <SkewNotification v-slot="{ isCurrentChunksOutdated, dismiss, reload }">
    <Transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      leave-active-class="transition duration-200 ease-in"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div v-if="isCurrentChunksOutdated" class="fixed bottom-4 right-4 z-50 max-w-sm">
        <UAlert
          color="primary"
          variant="soft"
          title="Update available"
          description="A new version is ready. Refresh to get the latest."
          :close-button="{ icon: 'i-heroicons-x-mark-20-solid' }"
          @close="dismiss"
        >
          <template #icon>
            <span>✨</span>
          </template>
          <template #actions>
            <UButton color="primary" size="xs" @click="reload">
              Refresh
            </UButton>
          </template>
        </UAlert>
      </div>
    </Transition>
  </SkewNotification>
</template>
