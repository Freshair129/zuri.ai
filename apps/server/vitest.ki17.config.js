import base from './vitest.config'

// @req FR-110 — the full pipeline acceptance gate requires explicit sibling
// runtimes and real native embeddings; missing prerequisites fail, never skip.
// @spec ADR-070
// @tested tests/acceptance/genesisrag17-e2e.test.js
export default {
  ...base,
  test: {
    ...base.test,
    include: ['tests/acceptance/genesisrag17-e2e.test.js'],
    testTimeout: 180000,
    hookTimeout: 180000,
  },
}
