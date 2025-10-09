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
        class="fixed bottom-4 right-4 z-50 max-w-sm"
      >
        <UCard
          :ui="{
            ring: 'ring-1 ring-gray-200 dark:ring-gray-800',
            shadow: 'shadow-xl',
          }"
        >
          <template #header>
            <div class="flex items-start justify-between">
              <div class="flex items-center gap-3">
                <div class="rounded-full bg-primary-100 dark:bg-primary-900 p-2">
                  <UIcon name="i-heroicons-sparkles" class="w-5 h-5 text-primary-600 dark:text-primary-400" />
                </div>
                <div>
                  <h3 class="text-base font-semibold text-gray-900 dark:text-white">
                    New update available!
                  </h3>
                  <p v-if="timeAgo" class="text-sm text-gray-500 dark:text-gray-400">
                    Released {{ timeAgo }}
                  </p>
                </div>
              </div>
              <UButton
                color="gray"
                variant="ghost"
                icon="i-heroicons-x-mark-20-solid"
                class="-my-1"
                @click="dismiss"
              />
            </div>
          </template>

          <p class="text-sm text-gray-600 dark:text-gray-300">
            A new version of the application is available. Refresh to get the latest features and improvements.
          </p>

          <template #footer>
            <div class="flex gap-2 justify-end">
              <UButton
                color="gray"
                variant="ghost"
                label="Later"
                @click="dismiss"
              />
              <UButton
                color="primary"
                label="Refresh Now"
                trailing-icon="i-heroicons-arrow-path"
                @click="reload"
              />
            </div>
          </template>
        </UCard>
      </div>
    </Transition>
  </SkewNotification>
</template>
