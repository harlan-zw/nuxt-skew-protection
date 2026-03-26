import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const CLI_PATH = join(__dirname, '../../bin/migrate.mjs')

function run(dir: string) {
  return execFileSync('node', [CLI_PATH, 'migrate', dir], { encoding: 'utf-8' })
}

describe('migrate codemod', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'skew-migrate-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('renames hook', () => {
    writeFileSync(join(dir, 'plugin.ts'), `nuxtApp.hooks.hook('skew-protection:chunks-outdated', cb)`)
    const output = run(dir)
    expect(readFileSync(join(dir, 'plugin.ts'), 'utf-8')).toBe(`nuxtApp.hooks.hook('skew:chunks-outdated', cb)`)
    expect(output).toContain('skew-protection:chunks-outdated -> skew:chunks-outdated')
  })

  it('renames isOutdated to isAppOutdated', () => {
    writeFileSync(join(dir, 'app.vue'), `<script setup>\nconst { isOutdated } = useSkewProtection()\n</script>`)
    run(dir)
    expect(readFileSync(join(dir, 'app.vue'), 'utf-8')).toBe(`<script setup>\nconst { isAppOutdated } = useSkewProtection()\n</script>`)
  })

  it('renames bundlePreviousDeploymentChunks to bundleAssets', () => {
    writeFileSync(join(dir, 'nuxt.config.ts'), `export default defineNuxtConfig({\n  skewProtection: { bundlePreviousDeploymentChunks: true }\n})`)
    run(dir)
    expect(readFileSync(join(dir, 'nuxt.config.ts'), 'utf-8')).toBe(`export default defineNuxtConfig({\n  skewProtection: { bundleAssets: true }\n})`)
  })

  it('updates route prefix from /_skew/ to /__skew/', () => {
    writeFileSync(join(dir, 'proxy.ts'), `const url = '/_skew/sse'`)
    run(dir)
    expect(readFileSync(join(dir, 'proxy.ts'), 'utf-8')).toBe(`const url = '/__skew/sse'`)
  })

  it('comments out standalone checkForUpdates import', () => {
    writeFileSync(join(dir, 'plugin.ts'), `import { checkForUpdates } from '#skew-protection'\ncheckForUpdates()`)
    run(dir)
    const result = readFileSync(join(dir, 'plugin.ts'), 'utf-8')
    expect(result).toContain('// Removed in v1')
    expect(result).toContain('useSkewProtection()')
    expect(result).not.toContain('from \'#skew-protection\'')
  })

  it('applies multiple replacements in one file', () => {
    writeFileSync(join(dir, 'app.vue'), [
      `<script setup>`,
      `const { isOutdated } = useSkewProtection()`,
      `nuxtApp.hooks.hook('skew-protection:chunks-outdated', () => {})`,
      `</script>`,
    ].join('\n'))
    const output = run(dir)
    const result = readFileSync(join(dir, 'app.vue'), 'utf-8')
    expect(result).toContain('isAppOutdated')
    expect(result).toContain('skew:chunks-outdated')
    expect(output).toContain('2 change(s) across 1 file(s)')
  })

  it('reports no migration needed when files are clean', () => {
    writeFileSync(join(dir, 'clean.ts'), `const { isAppOutdated } = useSkewProtection()`)
    const output = run(dir)
    expect(output).toContain('No migration needed')
  })

  it('ignores node_modules', () => {
    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'dep.ts'), `const { isOutdated } = useSkewProtection()`)
    const output = run(dir)
    expect(output).toContain('No migration needed')
  })

  it('ignores non-source files', () => {
    writeFileSync(join(dir, 'readme.md'), `Use isOutdated to check`)
    const output = run(dir)
    expect(output).toContain('No migration needed')
  })

  it('processes nested directories', () => {
    mkdirSync(join(dir, 'src', 'composables'), { recursive: true })
    writeFileSync(join(dir, 'src', 'composables', 'use.ts'), `const { isOutdated } = useSkewProtection()`)
    run(dir)
    expect(readFileSync(join(dir, 'src', 'composables', 'use.ts'), 'utf-8')).toContain('isAppOutdated')
  })
})
