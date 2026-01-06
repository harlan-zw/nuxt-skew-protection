<template>
  <SkewNotification v-slot="{ isCurrentChunksOutdated, dismiss, reload }">
    <Transition name="slide-up">
      <div v-if="isCurrentChunksOutdated" class="skew-native">
        <span class="skew-native-icon">✨</span>
        <span class="skew-native-text">Update available</span>
        <button class="skew-native-btn skew-native-btn-primary" @click="reload">
          Refresh
        </button>
        <button class="skew-native-btn skew-native-btn-ghost" @click="dismiss">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>
    </Transition>
  </SkewNotification>
</template>

<style scoped>
.skew-native {
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: white;
  border-radius: 9999px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
  padding: 0.5rem 0.5rem 0.5rem 1rem;
  border: 1px solid rgba(0, 0, 0, 0.06);
}
@media (prefers-color-scheme: dark) {
  .skew-native {
    background: #18181b;
    border-color: rgba(255, 255, 255, 0.1);
  }
}
.skew-native-icon {
  font-size: 0.875rem;
}
.skew-native-text {
  font-size: 0.875rem;
  font-weight: 500;
  color: #18181b;
}
@media (prefers-color-scheme: dark) {
  .skew-native-text {
    color: #fafafa;
  }
}
.skew-native-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.375rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: background 0.15s;
}
.skew-native-btn-primary {
  background: #18181b;
  color: white;
}
.skew-native-btn-primary:hover {
  background: #27272a;
}
@media (prefers-color-scheme: dark) {
  .skew-native-btn-primary {
    background: #fafafa;
    color: #18181b;
  }
  .skew-native-btn-primary:hover {
    background: #e4e4e7;
  }
}
.skew-native-btn-ghost {
  background: transparent;
  color: #71717a;
  padding: 0.375rem;
}
.skew-native-btn-ghost:hover {
  background: rgba(0, 0, 0, 0.05);
}
@media (prefers-color-scheme: dark) {
  .skew-native-btn-ghost:hover {
    background: rgba(255, 255, 255, 0.1);
  }
}
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(0.5rem);
}
</style>
