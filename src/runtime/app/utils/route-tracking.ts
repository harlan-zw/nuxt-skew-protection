import type { SkewConnection } from '../types'

export interface RouteTrackingRouter {
  currentRoute: { value: { path: string } }
  afterEach: (guard: (to: { path: string }) => void) => void
}

/**
 * Build the `?route=` query param appended to the initial SSE/WS connection URL
 * so the server knows the client's starting route when route tracking is on.
 */
export function resolveInitialRouteQuery(routeTracking: boolean | undefined, router: RouteTrackingRouter): string {
  return routeTracking ? `?route=${encodeURIComponent(router.currentRoute.value.path)}` : ''
}

/**
 * Send route updates to the server on client-side navigation when route tracking is on.
 */
export function trackRouteChanges(router: RouteTrackingRouter, routeTracking: boolean | undefined, skewConnection: SkewConnection): void {
  if (!routeTracking)
    return
  router.afterEach(to => skewConnection.sendRoute(to.path))
}
