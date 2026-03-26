import { defineEventHandler, getQuery } from 'h3'
import { $fetch } from 'ofetch'

const RE_TRAILING_SLASHES = /\/+$/

interface ProductionDebugResponse {
  health?: { ok: boolean, version: string, uptime: number } | null
  manifest?: Record<string, unknown> | null
  stats?: { total: number, versions: Record<string, number>, routes: Record<string, number> } | null
  errors: string[]
}

/**
 * Proxy endpoint that fetches debug data from a production site.
 * Avoids CORS issues by proxying through the dev server.
 */
export default defineEventHandler(async (event): Promise<ProductionDebugResponse> => {
  const { url } = getQuery(event) as { url?: string }

  if (!url) {
    return { errors: ['Missing url query parameter'] }
  }

  const errors: string[] = []
  const baseUrl = url.replace(RE_TRAILING_SLASHES, '')

  // Fetch health, manifest, and stats in parallel
  const [health, manifest] = await Promise.all([
    $fetch<{ ok: boolean, version: string, uptime: number }>(`${baseUrl}/__skew/health`, { timeout: 5000 })
      .catch((err) => {
        errors.push(`Health check failed: ${err.message}`)
        return null
      }),
    $fetch<Record<string, unknown>>(`${baseUrl}/builds/latest.json`, { timeout: 5000 })
      .catch((err) => {
        errors.push(`Manifest fetch failed: ${err.message}`)
        return null
      }),
  ])

  return {
    health,
    manifest,
    stats: null,
    errors,
  }
})
