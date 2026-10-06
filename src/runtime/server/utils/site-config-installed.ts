import type { RequestEvent } from 'nuxt/server'
import { getSiteConfig } from '#site-config/server/composables'

export function getSkewSiteConfigUrl(event: RequestEvent): string {
  return getSiteConfig(event).url || event.url.origin
}
