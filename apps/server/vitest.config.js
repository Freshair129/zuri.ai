import { defineConfig } from 'vitest/config'
import path from 'path'
import { fileURLToPath } from 'node:url'

const configDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(configDir, 'src'),
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
