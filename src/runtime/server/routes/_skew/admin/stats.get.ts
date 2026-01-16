import { createError, defineEventHandler, getHeader } from 'h3'
import { useNitroApp, useRuntimeConfig } from 'nitropack/runtime'

/**
 * Admin endpoint for nuxtseo.com dashboard to query live connection stats.
 * Requires Authorization header with SEO Pro key.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const seoProKey = config.seoProKey || process.env.NUXT_SEO_PRO_KEY

  if (!seoProKey) {
    throw createError({ statusCode: 503, message: 'SEO Pro key not configured' })
  }

  // Validate auth - accepts "Bearer <key>" or just "<key>"
  const authHeader = getHeader(event, 'authorization') || ''
  const providedKey = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader

  if (providedKey !== seoProKey) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  // Get stats via hook
  return new Promise((resolve) => {
    // @ts-expect-error custom hook
    useNitroApp().hooks.callHook('skew:stats', (stats: { total: number, versions: Record<string, number>, routes: Record<string, number> }) => {
      resolve(stats)
    })
  })
})
