<template>
  <SkewNotification v-slot="{ isOpen, dismiss, reload }">
    <Transition name="skew-update-notification">
      <section
        v-if="isOpen"
        class="skew-update-notification"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="skew-update-notification"
      >
        <strong class="skew-update-notification__label">Update available</strong>
        <button
          type="button"
          class="skew-update-notification__button skew-update-notification__button--primary"
          @click="reload"
        >
          Refresh
        </button>
        <button
          type="button"
          class="skew-update-notification__button skew-update-notification__button--dismiss"
          aria-label="Dismiss update"
          @click="dismiss"
        >
          <span aria-hidden="true">×</span>
        </button>
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
  gap: 0.375rem;
  align-items: center;
  inline-size: max-content;
  max-inline-size: calc(100vw - 2rem);
  padding: 0.5rem;
  color: var(--ui-text-highlighted, #18181b);
  font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
  background: var(--ui-bg-elevated, #fff);
  border: 1px solid var(--ui-border, #e4e4e7);
  border-radius: 9999px;
  box-shadow: 0 10px 28px rgb(24 24 27 / 16%);
}

.skew-update-notification__label {
  padding-inline: 0.5rem 0.625rem;
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.25;
  white-space: nowrap;
}

.skew-update-notification__button {
  min-block-size: 2.75rem;
  padding: 0.625rem 0.875rem;
  color: inherit;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 9999px;
  transition: background-color 140ms ease, color 140ms ease, opacity 140ms ease;
}

.skew-update-notification__button--primary {
  color: var(--ui-text-inverted, #fff);
  background: var(--ui-primary, #18181b);
}

.skew-update-notification__button--primary:hover {
  opacity: 0.88;
}

.skew-update-notification__button--dismiss {
  display: grid;
  place-items: center;
  inline-size: 2.75rem;
  padding: 0;
  color: var(--ui-text-muted, #52525b);
  font-size: 1.25rem;
  font-weight: 400;
}

.skew-update-notification__button--dismiss:hover {
  color: var(--ui-text-highlighted, #18181b);
  background: var(--ui-bg-muted, #f4f4f5);
}

.skew-update-notification__button:focus-visible {
  outline: 2px solid var(--ui-primary, #2563eb);
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
    color: var(--ui-text-highlighted, #fafafa);
    background: var(--ui-bg-elevated, #18181b);
    border-color: var(--ui-border, #3f3f46);
    box-shadow: 0 12px 32px rgb(0 0 0 / 35%);
  }

  .skew-update-notification__button--primary {
    color: var(--ui-text-inverted, #18181b);
    background: var(--ui-primary, #fafafa);
  }

  .skew-update-notification__button--dismiss {
    color: var(--ui-text-muted, #a1a1aa);
  }

  .skew-update-notification__button--dismiss:hover {
    color: var(--ui-text-highlighted, #fafafa);
    background: var(--ui-bg-muted, #27272a);
  }
}

@media (max-width: 30rem) {
  .skew-update-notification {
    inset-inline-end: max(0.75rem, env(safe-area-inset-right));
    max-inline-size: calc(100vw - 1.5rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .skew-update-notification-enter-active,
  .skew-update-notification-leave-active,
  .skew-update-notification__button {
    transition: none;
  }
}
</style>
