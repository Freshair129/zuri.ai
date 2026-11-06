// @spec ADR-115 — explicit heavyweight artifact/TEST target acceptance; no live LINE.
// @tested tests/integration/compact-knowledge-package.test.js
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/integration/compact-knowledge-package.test.js'], fileParallelism: false, hookTimeout: 120000, testTimeout: 120000 } })
