import { defineConfig, defineProject } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      // Unit tests
      defineProject({
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
      // E2E tests
      defineProject({
        test: {
          name: 'e2e',
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
