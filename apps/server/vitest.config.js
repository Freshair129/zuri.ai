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
    exclude: ['**/node_modules/**', '**/.git/**', 'tests/integration/compact-profile-recovery.test.js'],
    globalSetup: ['tests/global-setup.js'],
    setupFiles: ['tests/setup.js'],
    // Per-file SQLite clones isolate data; keep files serial to bound fixture/process load.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
