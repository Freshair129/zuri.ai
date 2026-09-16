import base from './vitest.config'

// @req FR-110 — the full pipeline acceptance gate requires explicit sibling
// runtimes and real native embeddings; missing prerequisites fail, never skip.
// @req FR-188 — the SmartGift structured-record profile is accepted by the same
// gate: both suites run under this one command, serially, each over its own
// isolated MSP/GKS/GenesisBlock processes (ADR-075 Phase 2, contract rev 2 C-8).
// @spec ADR-073, ADR-075
// @tested tests/acceptance/genesisrag17-e2e.test.js, tests/acceptance/genesisrag17-smartgift.test.js
export default {
  ...base,
  test: {
    ...base.test,
    include: [
      'tests/acceptance/genesisrag17-e2e.test.js',
      'tests/acceptance/genesisrag17-smartgift.test.js',
    ],
    testTimeout: 180000,
    hookTimeout: 180000,
  },
}
