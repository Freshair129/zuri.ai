// @spec ADR-115 — explicit real-image idle TEST cohort; no live LINE or serving grant.
// @tested tests/integration/compact-knowledge-cohort.test.js
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/integration/compact-knowledge-cohort.test.js'], fileParallelism: false, hookTimeout: 120000, testTimeout: 120000 } })
