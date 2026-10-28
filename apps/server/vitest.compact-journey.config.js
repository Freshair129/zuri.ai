// @spec ADR-115 — explicit full native operation class, isolated from ordinary Server setup.
// @tested tests/integration/compact-knowledge-journey.test.js
import { defineConfig } from 'vitest/config'
import base from './vitest.config'
export default defineConfig({ resolve: base.resolve, test: { include: ['tests/integration/compact-knowledge-journey.test.js'], environment: 'node', fileParallelism: false, testTimeout: 15 * 60 * 1000, hookTimeout: 5 * 60 * 1000 } })
