// @req FR-173 — actual-provider Knowledge object recovery is an explicit,
//   isolated TEST profile and is not part of default CI selection.
// @spec TASK-ZAI-049 §8.1, ADR-057
// @tested tests/storage/knowledge-object-restore.test.js

import postgres from './vitest.postgres.config.js'

export default {
  ...postgres,
  test: {
    ...postgres.test,
    include: ['tests/storage/knowledge-object-restore.test.js'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
}
