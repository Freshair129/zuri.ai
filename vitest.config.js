import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    globalSetup: ['tests/global-setup.js'],
    setupFiles: ['tests/setup.js'],
    // SQLite file DB: run test files serially to avoid writer lock contention.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
