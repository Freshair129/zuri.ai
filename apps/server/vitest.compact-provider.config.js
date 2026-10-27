// @spec ADR-115 — explicit owned provider-only probe; no application database.
// @tested tests/storage/compact-provider-transport.test.js
import base from './vitest.config'
export default { ...base, test: { ...base.test, include: ['tests/storage/compact-provider-transport.test.js'], globalSetup: [], setupFiles: [], hookTimeout: 120000, testTimeout: 120000 } }
