import { resolve } from 'node:path'
import { defineConfig, defineProject } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      // Unit tests
      defineProject({
        resolve: {
          alias: { '#skew-protection/bot-detection': resolve('./src/runtime/app/utils/bot-detection-none.ts') },
        },
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            './test/unit/**/*.test.ts',
            './src/**/*.test.ts',
          ],
          exclude: [
            '**/node_modules/**',
          ],
        },
      }),
      // Integration tests
      defineProject({
        test: {
          name: 'integration',
          environment: 'node',
          include: [
            './test/integration/**/*.test.ts',
          ],
          exclude: [
            '**/node_modules/**',
          ],
        },
      }),
      // E2E tests (sequential to avoid fixture directory races)
      defineProject({
        test: {
          name: 'e2e',
          fileParallelism: false,
          include: [
            './test/e2e/**/*.test.ts',
          ],
          exclude: [
            '**/node_modules/**',
          ],
        },
      }),
    ],
  },
})
