import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  clean: false,
  outDir: 'dist',
  declaration: true,
  entries: [
    './src/adapters/index',
    './src/adapters/logger',
    // Main entry (user imports from nuxt.config)
    './src/adapters/pusher/index',
    './src/adapters/ably/index',
    // Platform-specific (module loads these internally)
    './src/adapters/pusher/web',
    './src/adapters/ably/web',
    './src/adapters/pusher/node',
    './src/adapters/ably/node',
  ],
  externals: [
    'h3',
    'std-env',
    'nitropack',
    'consola',
    'unstorage',
    'pathe',
    'unstorage/drivers/fs',
    '#skew-adapter',
    'pusher-js',
    '@unhead/vue',
    'nuxt/app',
  ],
  failOnWarn: false,
})
