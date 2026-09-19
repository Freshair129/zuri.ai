// @req FR-230 — the one string a retention-swept message body carries,
//   pulled out of retention-sweep-service.js so chat-evidence-archive-service.js
//   can share it without a circular import (the sweep service calls the
//   archive service, which writes this same tombstone once its archive is
//   verified). Re-exported from retention-sweep-service.js unchanged, so every
//   existing import of it keeps working.
// @spec ADR-093 D2
// @tested tests/integration/crm-retention-sweep.test.js, tests/integration/crm-chat-evidence-archive.test.js

/** The one string a retention-swept message body carries — distinct from the PDPA
 * erasure and LINE-unsend tombstones, because "past its retention window" is a
 * different fact than either, and the FR-091/FR-233 inbox reader should read them
 * differently if it ever needs to (it does not today; the distinction is free). */
export const RETENTION_SWEEP_TOMBSTONE = '[ข้อความถูกลบตามนโยบายเก็บรักษาข้อมูล]'
