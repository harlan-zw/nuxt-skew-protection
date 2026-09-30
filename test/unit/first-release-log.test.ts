import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { loadNuxt } from 'nuxt'
import { join } from 'pathe'
import { describe, expect, it } from 'vitest'
import { logger } from '../../src/logger'
import skewProtection from '../../src/module'

describe('first release diagnostics', () => {
  it.each(['fs', 'memory'])('reports a first %s release at the appropriate severity', async (driver) => {
    const rootDir = await mkdtemp(join(tmpdir(), 'skew-first-release-'))
    const publicDir = join(rootDir, 'public')
    await mkdir(join(publicDir, '_nuxt', 'builds', 'meta'), { recursive: true })
    await writeFile(join(publicDir, '_nuxt', 'builds', 'latest.json'), JSON.stringify({ id: 'first-build' }))
    await writeFile(join(publicDir, '_nuxt', 'builds', 'meta', 'first-build.json'), JSON.stringify({ id: 'first-build' }))
    await writeFile(join(publicDir, '_nuxt', 'entry.hash.js'), 'export default 1')
    const nuxt = await loadNuxt({
      cwd: rootDir,
      ready: false,
      overrides: {
        dev: false,
        buildId: 'first-build',
        modules: [skewProtection],
        skewProtection: { storage: { driver, base: join(rootDir, 'storage') }, bundleAssets: true },
      },
    })
    const messages: { type: string, args: unknown[] }[] = []
    const reporter = { log: (record: { type: string, args: unknown[] }) => messages.push({ type: record.type, args: record.args }) }
    logger.addReporter(reporter)
    try {
      await nuxt.ready()
      messages.length = 0
      await nuxt.callHook('nitro:build:public-assets', { hooks: nuxt.hooks, options: { output: { publicDir } } } as any)
      const firstRelease = messages.filter(message => message.args.some(arg => typeof arg === 'string' && /first release|No previous versions/.test(arg)))
      expect(firstRelease.map(message => message.type)).toEqual([driver === 'fs' ? 'info' : 'warn'])
    }
    finally {
      logger.removeReporter(reporter)
      await nuxt.close()
      await rm(rootDir, { recursive: true, force: true })
    }
  })
})
