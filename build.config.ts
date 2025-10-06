import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  declaration: true,
  failOnWarn: false,
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
    'unstorage/drivers/fs',
  ],
})
