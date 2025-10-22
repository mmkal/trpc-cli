import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['*ignoreme*', 'node_modules'],
    setupFiles: ['./test/setup.ts'],
    typecheck: {
      enabled: true,
      include: ['test/types.test.ts'],
    },
    testTimeout: 10_000,
  },
})
