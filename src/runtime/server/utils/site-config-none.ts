import type { RequestEvent } from 'nuxt/server'

export function getSkewSiteConfigUrl(event: RequestEvent): string {
  return event.url.origin
}
