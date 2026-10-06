declare module '#skew-protection/bot-detection' {
  export function useSkewBotDetection(): boolean
}

declare module '#skew-protection/site-config' {
  import type { RequestEvent } from 'nuxt/server'

  export function getSkewSiteConfigUrl(event: RequestEvent): string
}
