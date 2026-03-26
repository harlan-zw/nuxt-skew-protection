#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Codemod for migrating nuxt-skew-protection v0.x to v1.0.0
 *
 * Usage: npx nuxt-skew-protection migrate
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const SOURCE_EXTENSIONS = new Set(['.vue', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts'])
const IGNORE_DIRS = new Set(['node_modules', '.nuxt', '.output', 'dist', '.git'])

const replacements = [
  {
    name: 'hook: skew-protection:chunks-outdated -> skew:chunks-outdated',
    pattern: /skew-protection:chunks-outdated/g,
    replacement: 'skew:chunks-outdated',
  },
  {
    name: 'composable: isOutdated -> isAppOutdated',
    pattern: /\bisOutdated\b/g,
    replacement: 'isAppOutdated',
    fileFilter: p => SOURCE_EXTENSIONS.has(p.slice(p.lastIndexOf('.'))),
  },
  {
    name: 'config: bundlePreviousDeploymentChunks -> bundleAssets',
    pattern: /bundlePreviousDeploymentChunks/g,
    replacement: 'bundleAssets',
  },
  {
    name: 'route prefix: /_skew/ -> /__skew/',
    pattern: /\/_skew\//g,
    replacement: '/__skew/',
  },
  {
    name: 'import: standalone checkForUpdates removed',
    pattern: /import\s*\{\s*checkForUpdates\s*\}\s*from\s*['"]#skew-protection['"]/g,
    replacement: '// Removed in v1: use `const { checkForUpdates } = useSkewProtection()` instead',
  },
]

function walkDir(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name))
        files.push(...walkDir(join(dir, entry.name)))
    }
    else if (SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
      files.push(join(dir, entry.name))
    }
  }
  return files
}

function migrate(cwd) {
  const files = walkDir(cwd)
  const changes = []

  for (const file of files) {
    let content
    try {
      content = readFileSync(file, 'utf-8')
    }
    catch {
      continue
    }

    let modified = content
    for (const r of replacements) {
      if (r.fileFilter && !r.fileFilter(file))
        continue

      const matches = modified.match(r.pattern)
      if (matches && matches.length > 0) {
        modified = modified.replace(r.pattern, r.replacement)
        changes.push({ file: file.replace(cwd, '.'), name: r.name, count: matches.length })
      }
    }

    if (modified !== content) {
      writeFileSync(file, modified, 'utf-8')
    }
  }

  return { changes, totalFiles: files.length }
}

// CLI entry
const command = process.argv[2]

if (command !== 'migrate') {
  console.log(`\nnuxt-skew-protection CLI\n`)
  console.log(`Commands:`)
  console.log(`  migrate [dir]  Run v1.0.0 migration codemod\n`)
  console.log(`Usage: npx nuxt-skew-protection migrate`)
  process.exit(0)
}

const cwd = resolve(process.argv[3] || '.')

console.log(`\nnuxt-skew-protection: migrating to v1.0.0...\n`)
console.log(`Scanning: ${cwd}\n`)

const { changes, totalFiles } = migrate(cwd)

if (changes.length === 0) {
  console.log(`Scanned ${totalFiles} files. No migration needed!\n`)
}
else {
  const fileSet = new Set(changes.map(c => c.file))
  console.log(`Found ${changes.length} change(s) across ${fileSet.size} file(s):\n`)

  const byFile = new Map()
  for (const change of changes) {
    const existing = byFile.get(change.file) || []
    existing.push(change)
    byFile.set(change.file, existing)
  }

  for (const [file, fileChanges] of byFile) {
    console.log(`  ${file}`)
    for (const c of fileChanges) {
      console.log(`    -> ${c.name} (${c.count}x)`)
    }
  }

  console.log(`\nMigration complete! Run \`npx nuxi typecheck\` to verify.\n`)
}
