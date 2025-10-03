import fs from 'node:fs'
import path from 'node:path'
import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  declaration: false,
  clean: false,
  name: 'minified',
  entries: ['./sw/sw.js'],
  outDir: 'src',
  rollup: {
    esbuild: {
      minify: true,
    },
  },
  hooks: {
    'build:done': function (ctx) {
      // need to rename src/sw/sw.mjs to src/sw/sw.js
      fs.renameSync(path.join(ctx.options.outDir, 'sw', 'sw.mjs'), path.join(ctx.options.outDir, 'sw', 'sw.js'))
    },
  },
  failOnWarn: false,
})
