// @spec ADR-115 — explicitly selected Docker lifecycle probe; no app DB, AI or LINE.
// @tested tests/integration/compact-profile-recovery.test.js
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/integration/compact-profile-recovery.test.js'], fileParallelism: false, hookTimeout: 120000, testTimeout: 60000 } })
