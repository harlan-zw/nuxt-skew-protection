import { useNuxtApp, useRuntimeConfig } from 'nuxt/app'
import { computed, ref } from 'vue'

export interface ConnectionStats {
  total: number
  versions: Record<string, number>
}

const stats = ref<ConnectionStats>({ total: 0, versions: {} })
let hooked = false

export function useActiveConnections() {
  const config = useRuntimeConfig().public.skewProtection as { connectionTracking?: boolean } | undefined
  if (!config?.connectionTracking) {
    throw new Error('[nuxt-skew-protection] useActiveConnections() requires `connectionTracking: true` in your module config.')
  }

  if (!hooked) {
    hooked = true
    // @ts-expect-error custom hook
    useNuxtApp().hooks.hook('skew:message', (message: { type: string, total?: number, versions?: Record<string, number> }) => {
      if (message.type === 'stats')
        stats.value = { total: message.total!, versions: message.versions! }
    })
  }

  return {
    total: computed(() => stats.value.total),
    versions: computed(() => stats.value.versions),
  }
}
