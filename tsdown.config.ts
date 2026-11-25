import { builder } from '@nuxt/module-builder/tsdown'
import { defineConfig } from 'tsdown'

export default defineConfig({
  plugins: [
    builder({
      externals: [
        'nuxt/server',
        'wrangler',
      ],
    }),
  ],
})
