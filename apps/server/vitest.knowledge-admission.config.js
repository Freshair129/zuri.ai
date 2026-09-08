import base from './vitest.config'

// @req FR-173 — the owner-facing knowledge admission acceptance executes the
// actual Next/HTTP/browser/native recovery path, rather than being hidden by the
// unit/integration include in the base Vitest configuration.
// @spec ADR-072, ADR-073
// @tested tests/acceptance/knowledge-admission-native.test.js
export default {
  ...base,
  test: {
    ...base.test,
    include: ['tests/acceptance/knowledge-admission-native.test.js'],
    testTimeout: 15 * 60 * 1000,
    hookTimeout: 5 * 60 * 1000,
  },
}
