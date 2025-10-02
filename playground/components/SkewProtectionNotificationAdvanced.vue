<script setup lang="ts">
import { ref } from 'vue'

// Example showing how to use the composable for advanced features
const versionsBehind = ref(0)
const releaseDate = ref<Date | null>(null)

// Access the slot props to get utility functions
async function loadVersionInfo(getVersionsBehind: () => Promise<number>, getReleaseDate: (version?: string) => Promise<Date | null>, newVersion: string) {
  versionsBehind.value = await getVersionsBehind()
  releaseDate.value = await getReleaseDate(newVersion)
}
</script>

<template>
  <SkewNotificationRoot>
    <template #default="{ dismiss, reload: _reload, newVersion, currentVersion, getVersionsBehind, getReleaseDate }">
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
        @click="dismiss"
      />

      <SkewNotificationContent
        :style="{
          position: 'relative',
          backgroundColor: 'white',
          borderRadius: '8px',
          padding: '1.5rem',
          maxWidth: '500px',
          width: '90%',
          boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)',
          border: '1px solid #e5e7eb',
          zIndex: '51',
          margin: 'auto',
        }"
        @vue:mounted="loadVersionInfo(getVersionsBehind, getReleaseDate, newVersion)"
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
              marginBottom: '0.75rem',
            }"
          >
            A new version of the application is available.
          </SkewNotificationDescription>

          <!-- Version info -->
          <div :style="{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.5rem' }">
            <div v-if="versionsBehind > 0">
              You are {{ versionsBehind }} version{{ versionsBehind > 1 ? 's' : '' }} behind
            </div>
            <div v-if="releaseDate">
              Released: {{ releaseDate.toLocaleString() }}
            </div>
            <div v-if="currentVersion">
              Current: {{ currentVersion }}
            </div>
            <div v-if="newVersion">
              Latest: {{ newVersion }}
            </div>
          </div>
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
          >
            Later
          </SkewNotificationDismissButton>
        </SkewNotificationActions>
      </SkewNotificationContent>
    </template>
  </SkewNotificationRoot>
</template>
