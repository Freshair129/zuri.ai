// @req FR-292 — real browser/request/custody flow on owned disposable PostgreSQL.
// @spec ADR-115
// @tested tests/browser/managed-blob-recovery-browser.test.js
import postgres from './vitest.postgres.config'

// Explicit non-skipping acceptance lane: ordinary Server tests do not acquire
// a Chromium dependency. Uses embedded-only setup; reads no target URL/env DB.
export default { ...postgres, test: { ...postgres.test,
  include: ['tests/browser/managed-blob-recovery-browser.test.js'],
} }
