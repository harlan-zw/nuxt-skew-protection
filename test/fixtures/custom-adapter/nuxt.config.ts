import Module from '../../../src/module'
import { myAdapter } from './my-adapter'

export default defineNuxtConfig({
  modules: [async (_options, nuxt) => {
    await Module({
      bundleAssets: false,
      storage: {
        driver: 'fs',
        base: '.skew-storage',
      },
      updateStrategy: myAdapter({ endpoint: 'https://updates.example.test' }),
    }, nuxt)
  }],
  compatibilityDate: '2024-11-01',
})
