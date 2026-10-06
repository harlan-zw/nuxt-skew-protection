import { defineEventHandler, getQuery } from 'nuxt/server'

const RE_TRAILING_SLASHES = /\/+$/

async function fetchDebugJson<T>(url: string): Promise<T> {
  const request = () => fetch(url, { signal: AbortSignal.timeout(5000) })
  const first = await request().then(response => ({ _tag: 'Response' as const, response })).catch((error: unknown) => ({ _tag: 'Error' as const, error }))
  let response: Response
  if (first._tag === 'Response' && ![408, 409, 425, 429, 500, 502, 503, 504].includes(first.response.status)) {
    response = first.response
  }
  else {
    if (first._tag === 'Response')
      await first.response.body?.cancel()
    response = await request()
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<T>
}

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
    fetchDebugJson<{ ok: boolean, version: string, uptime: number }>(`${baseUrl}/__skew/health`)
      .catch((err) => {
        errors.push(`Health check failed: ${err.message}`)
        return null
      }),
    fetchDebugJson<Record<string, unknown>>(`${baseUrl}/builds/latest.json`)
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
