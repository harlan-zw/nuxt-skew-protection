<script setup lang="ts">
import { useState } from 'nuxt/app'

const customNotificationCount = useState('skew-custom-notification-count', () => 0)
</script>

<template>
  <SkewNotification v-if="customNotificationCount === 0" v-slot="{ isOpen, dismiss, reload }" fallback>
    <Transition name="skew-update-notification">
      <section
        v-if="isOpen"
        class="skew-update-notification"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="skew-update-notification"
      >
        <div class="skew-update-notification__copy">
          <strong>Update available</strong>
          <span>A new version is ready.</span>
        </div>

        <div class="skew-update-notification__actions">
          <button
            type="button"
            class="skew-update-notification__button skew-update-notification__button--primary"
            @click="reload"
          >
            Refresh
          </button>
          <button
            type="button"
            class="skew-update-notification__button skew-update-notification__button--secondary"
            aria-label="Dismiss update"
            @click="dismiss"
          >
            Dismiss
          </button>
        </div>
      </section>
    </Transition>
  </SkewNotification>
</template>

<style scoped>
.skew-update-notification {
  position: fixed;
  z-index: 2147483000;
  inset-inline-end: max(1rem, env(safe-area-inset-right));
  inset-block-end: max(1rem, env(safe-area-inset-bottom));
  box-sizing: border-box;
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  inline-size: min(28rem, calc(100vw - 2rem));
  padding: 0.875rem;
  color: #18181b;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #fff;
  border: 1px solid #e4e4e7;
  border-radius: 0.75rem;
  box-shadow: 0 12px 32px rgb(24 24 27 / 14%);
}

.skew-update-notification__copy {
  display: grid;
  min-inline-size: 0;
  line-height: 1.35;
}

.skew-update-notification__copy strong {
  font-size: 0.875rem;
  font-weight: 650;
}

.skew-update-notification__copy span {
  margin-block-start: 0.125rem;
  color: #71717a;
  font-size: 0.8125rem;
}

.skew-update-notification__actions {
  display: flex;
  flex: none;
  gap: 0.375rem;
}

.skew-update-notification__button {
  min-block-size: 2.75rem;
  padding: 0.4375rem 0.75rem;
  color: inherit;
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0.5rem;
}

.skew-update-notification__button--primary {
  color: #fff;
  background: #18181b;
}

.skew-update-notification__button--primary:hover {
  background: #3f3f46;
}

.skew-update-notification__button--secondary {
  color: #52525b;
}

.skew-update-notification__button--secondary:hover {
  background: #f4f4f5;
}

.skew-update-notification__button:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

.skew-update-notification-enter-active,
.skew-update-notification-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

.skew-update-notification-enter-from,
.skew-update-notification-leave-to {
  opacity: 0;
  transform: translateY(0.5rem);
}

@media (prefers-color-scheme: dark) {
  .skew-update-notification {
    color: #fafafa;
    background: #18181b;
    border-color: #3f3f46;
    box-shadow: 0 12px 32px rgb(0 0 0 / 35%);
  }

  .skew-update-notification__copy span,
  .skew-update-notification__button--secondary {
    color: #a1a1aa;
  }

  .skew-update-notification__button--primary {
    color: #18181b;
    background: #fafafa;
  }

  .skew-update-notification__button--primary:hover {
    background: #d4d4d8;
  }

  .skew-update-notification__button--secondary:hover {
    background: #27272a;
  }
}

@media (max-width: 30rem) {
  .skew-update-notification {
    inset-inline-start: max(0.75rem, env(safe-area-inset-left));
    inset-inline-end: max(0.75rem, env(safe-area-inset-right));
    inline-size: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skew-update-notification-enter-active,
  .skew-update-notification-leave-active {
    transition: none;
  }
}
</style>
