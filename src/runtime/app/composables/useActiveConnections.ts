import { useNuxtApp, useRuntimeConfig, useState } from 'nuxt/app'
import { computed } from 'vue'

export interface ConnectionInfo {
  id: string
  version: string
  route: string
  ip?: string
}

export interface ConnectionStats {
  total: number
  versions: Record<string, number>
  routes: Record<string, number>
  connections: ConnectionInfo[]
  yourId?: string
}

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
 *   nitroApp.hooks.hook('skew:authorize-stats', async ({ event, authorize }) => {
 *     const session = await getUserSession(event)
 *     if (session.user?.role === 'admin') {
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

  // Use useState for proper SSR hydration and client-side reactivity
  const stats = useState<ConnectionStats>('skew-stats', () => ({ total: 0, versions: {}, routes: {}, connections: [] }))
  const authorized = useState<boolean | null>('skew-authorized', () => null)

  // Track subscription at app level to avoid duplicate hooks
  const subscribed = nuxtApp._skewStatsSubscribed as boolean | undefined

  if (!subscribed) {
    nuxtApp._skewStatsSubscribed = true

    nuxtApp.hooks.hook('skew:message', (message: { type: string, total?: number, versions?: Record<string, number>, routes?: Record<string, number>, connections?: ConnectionInfo[], yourId?: string }) => {
      if (message.type === 'connected') {
        nuxtApp.$skewConnection?.subscribeStats()
      }
      else if (message.type === 'stats') {
        authorized.value = true
        stats.value = {
          total: message.total!,
          versions: message.versions!,
          routes: message.routes || {},
          connections: message.connections || [],
          yourId: message.yourId,
        }
      }
      else if (message.type === 'stats-unauthorized') {
        authorized.value = false
      }
    })

    // Ensure connection is started
    const startConnection = () => {
      nuxtApp.$skewConnection?.connect()
      // Also try subscribing immediately in case already connected (client-side nav)
      nuxtApp.$skewConnection?.subscribeStats()
    }

    if (nuxtApp.$skewConnection) {
      startConnection()
    }
    else {
      nuxtApp.hook('app:suspense:resolve', startConnection)
    }
  }
  else {
    // Already subscribed, but try again if not yet authorized
    nuxtApp.$skewConnection?.subscribeStats()
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
    /** Individual connections with id, version, route */
    connections: computed(() => stats.value.connections),
    /** Your connection ID (to identify yourself in the list) */
    yourId: computed(() => stats.value.yourId),
  }
}
