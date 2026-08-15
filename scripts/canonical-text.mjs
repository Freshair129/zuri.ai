import { readFileSync } from 'node:fs'

// @spec docs/ADR-004-DOC-STRUCTURE.md — the doc governance tools derive identity
//   from file content, so that identity must not depend on how git materialized
//   the file. `core.autocrlf` makes the same blob land as LF or CRLF depending on
//   the checkout; hashing raw bytes then reports drift for content that never
//   changed. Second occurrence of this failure mode — see
//   .brain/rca/2026-08-14-business-knowledge-export-hash-newline.md and
//   .brain/rca/2026-08-16-doc-graph-line-ending-hash-drift.md.
// @tested tests/unit/doc-graph-canonical-text.test.js

/** Canonical LF form of a text buffer. Idempotent; lone \r is left alone. */
export function normalizeNewlines(text) {
  return text.replace(/\r\n/g, '\n')
}

/** Read a repository file in its canonical LF form. */
export function readCanonical(filePath) {
  return normalizeNewlines(readFileSync(filePath, 'utf8'))
}
