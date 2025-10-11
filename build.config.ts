import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
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
