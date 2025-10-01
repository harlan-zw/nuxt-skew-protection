import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  declaration: true,
  rollup: {
    emitCJS: true,
  },
  externals: [
    'h3',
    'std-env',
    'nitropack',
    'consola',
    'unstorage',
    'pathe',
  ],
})
