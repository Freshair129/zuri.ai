// @spec ADR-115 — explicit owned TEST recovery probe; no ambient DB or restore API.
// @tested tests/postgres/compact-recovery.test.js
import base from './vitest.config'
export default { ...base, test: { ...base.test, include: ['tests/postgres/compact-recovery.test.js'], globalSetup: [], setupFiles: [], hookTimeout: 120000, testTimeout: 240000 } }
