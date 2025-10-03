import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  declaration: false,
  name: 'minified',
  entries: ['./sw/sw.js'],
  outDir: 'src',
  rollup: {
    esbuild: {
      minify: true,
    },
  },
})
