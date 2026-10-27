// @spec ADR-115 — real owned object-provider acceptance with a separate disposable application database.
// @tested tests/storage/compact-business-objects.test.js
import base from './vitest.config'
export default { ...base, test: { ...base.test, setupFiles: ['tests/setup-compact-storage.js', ...base.test.setupFiles], include: ['tests/storage/compact-business-objects.test.js'], hookTimeout: 120000, testTimeout: 60000 } }
