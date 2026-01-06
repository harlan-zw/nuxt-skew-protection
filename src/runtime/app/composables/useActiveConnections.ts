import { useNuxtApp, useRuntimeConfig } from 'nuxt/app'
import { computed, ref } from 'vue'
import { SKEW_MESSAGE_TYPE } from '../../const'

export interface ConnectionStats {
  total: number
  versions: Record<string, number>
  routes: Record<string, number>
}

const stats = ref<ConnectionStats>({ total: 0, versions: {}, routes: {} })
const authorized = ref<boolean | null>(null) // null = pending, true = authorized, false = denied
let subscribed = false

/**
 * Subscribe to real-time connection statistics.
 *
 * Requires:
 * - `connectionTracking: true` in module config
 * - Server-side `skew:authorize-stats` hook to authorize the subscription
 *
 * @example
 * ```ts
 * // server/plugins/stats-auth.ts
 * export default defineNitroPlugin((nitroApp) => {
 *   nitroApp.hooks.hook('skew:authorize-stats', ({ request, authorize }) => {
 *     const url = new URL(request.url)
 *     if (url.searchParams.get('admin') === 'secret') {
 *       authorize()
 *     }
 *   })
 * })
 * ```
 */
export function useActiveConnections() {
  const nuxtApp = useNuxtApp()
  const config = useRuntimeConfig().public.skewProtection as { connectionTracking?: boolean } | undefined

  if (!config?.connectionTracking) {
    throw new Error('[nuxt-skew-protection] useActiveConnections() requires `connectionTracking: true` in your module config.')
  }

  if (!subscribed) {
    subscribed = true

    // Listen for stats messages
    nuxtApp.hooks.hook('skew:message', (message: { type: string, total?: number, versions?: Record<string, number>, routes?: Record<string, number> }) => {
      if (message.type === 'stats') {
        authorized.value = true
        stats.value = {
          total: message.total!,
          versions: message.versions!,
          routes: message.routes || {},
        }
      }
      else if (message.type === 'stats-unauthorized') {
        authorized.value = false
      }
    })

    // Send subscription request after connection is established
    nuxtApp.hook('app:suspense:resolve', () => {
      const connection = nuxtApp.$skewConnection
      if (connection) {
        connection.send({ type: SKEW_MESSAGE_TYPE.SUBSCRIBE_STATS })
      }
    })
  }

  return {
    /** Whether the subscription is authorized (null while pending) */
    authorized: computed(() => authorized.value),
    /** Total active connections */
    total: computed(() => stats.value.total),
    /** Users per build version */
    versions: computed(() => stats.value.versions),
    /** Users per route (requires routeTracking: true) */
    routes: computed(() => stats.value.routes),
  }
}
