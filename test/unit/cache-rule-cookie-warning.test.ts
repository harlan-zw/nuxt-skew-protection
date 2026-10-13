import type { ModuleOptions } from '../../src/module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { loadNuxt } from 'nuxt'
import { join } from 'pathe'
import { describe, expect, it } from 'vitest'
import { logger } from '../../src/logger'
import skewProtection from '../../src/module'

async function setupWarnings(cookie: ModuleOptions['cookie']) {
  const rootDir = await mkdtemp(join(tmpdir(), 'skew-cookie-warning-'))
  const nuxt = await loadNuxt({
    cwd: rootDir,
    ready: false,
    overrides: {
      dev: true,
      modules: [skewProtection],
      skewProtection: { cookie },
      routeRules: { '/docs/**': { headers: { 'Cache-Control': 'public, max-age=3600' } } },
    },
  })
  const warnings: string[] = []
  const reporter = {
    log: (record: { type: string, args: unknown[] }) => {
      if (record.type === 'warn')
        warnings.push(record.args.filter(arg => typeof arg === 'string').join(' '))
    },
  }
  logger.addReporter(reporter)
  try {
    await nuxt.ready()
    return warnings
  }
  finally {
    logger.removeReporter(reporter)
    await nuxt.close()
    await rm(rootDir, { recursive: true, force: true })
  }
}

describe('max-age route rule warning', () => {
  it('warns that a max-age rule drops the version cookie', async () => {
    const warnings = await setupWarnings({})
    expect(warnings.filter(warning => warning.includes('version cookie'))).toHaveLength(1)
  })

  it('stays quiet when the version cookie is off', async () => {
    const warnings = await setupWarnings(false)
    expect(warnings.filter(warning => warning.includes('version cookie'))).toEqual([])
  })
})
