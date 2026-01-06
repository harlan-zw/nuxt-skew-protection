<template>
  <SkewNotification v-slot="{ isCurrentChunksOutdated, dismiss, reload }">
    <Transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      leave-active-class="transition duration-200 ease-in"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div v-if="isCurrentChunksOutdated" class="fixed bottom-4 right-4 z-50 w-80">
        <UCard>
          <div class="flex gap-3">
            <div class="shrink-0 size-10 rounded-full bg-primary-50 dark:bg-primary-950 flex items-center justify-center">
              <UIcon name="i-heroicons-sparkles" class="size-5 text-primary-500" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-2">
                <h3 class="font-semibold text-gray-900 dark:text-white">
                  Update available
                </h3>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-heroicons-x-mark-20-solid"
                  class="-mt-1 -mr-1"
                  @click="dismiss"
                />
              </div>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                A new version is ready
              </p>
              <div class="flex gap-2 mt-3">
                <UButton color="primary" size="xs" @click="reload">
                  Refresh now
                </UButton>
                <UButton color="neutral" variant="ghost" size="xs" @click="dismiss">
                  Later
                </UButton>
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </Transition>
  </SkewNotification>
</template>
