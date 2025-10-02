<script setup lang="ts">
// Component automatically syncs with version tracker in auto mode (default)
</script>

<template>
  <SkewNotificationRoot>
    <template #default="{ dismiss: _dismiss, reload: _reload, newVersion: _newVersion, currentVersion: _currentVersion }">
      <SkewNotificationOverlay
        :style="{
          position: 'fixed',
          inset: '0',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          zIndex: '50',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }"
      />

      <SkewNotificationContent
        :style="{
          position: 'relative',
          backgroundColor: 'white',
          borderRadius: '8px',
          padding: '1.5rem',
          maxWidth: '400px',
          width: '90%',
          boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)',
          border: '1px solid #e5e7eb',
          zIndex: '51',
          margin: 'auto',
        }"
      >
        <SkewNotificationHeader :style="{ marginBottom: '1rem' }">
          <SkewNotificationTitle
            :style="{
              fontSize: '1.25rem',
              fontWeight: '600',
              marginBottom: '0.5rem',
              color: '#111827',
            }"
          >
            Update Available
          </SkewNotificationTitle>
          <SkewNotificationDescription
            :style="{
              color: '#6b7280',
              fontSize: '0.875rem',
              lineHeight: '1.25rem',
            }"
          >
            A new version of the application is available. Refresh to get the latest updates.
          </SkewNotificationDescription>
        </SkewNotificationHeader>

        <SkewNotificationActions
          :style="{
            display: 'flex',
            gap: '0.75rem',
            justifyContent: 'flex-end',
            marginTop: '1.5rem',
          }"
        >
          <SkewNotificationReloadButton
            :style="{
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              fontWeight: '500',
              cursor: 'pointer',
              transition: 'background-color 0.2s',
            }"
            @mouseenter="$event.target.style.backgroundColor = '#2563eb'"
            @mouseleave="$event.target.style.backgroundColor = '#3b82f6'"
          >
            Refresh Now
          </SkewNotificationReloadButton>
          <SkewNotificationDismissButton
            :style="{
              backgroundColor: '#f9fafb',
              color: '#374151',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              fontWeight: '500',
              cursor: 'pointer',
              transition: 'background-color 0.2s',
            }"
            @mouseenter="$event.target.style.backgroundColor = '#f3f4f6'"
            @mouseleave="$event.target.style.backgroundColor = '#f9fafb'"
          >
            Continue
          </SkewNotificationDismissButton>
        </SkewNotificationActions>
      </SkewNotificationContent>
    </template>
  </SkewNotificationRoot>
</template>
