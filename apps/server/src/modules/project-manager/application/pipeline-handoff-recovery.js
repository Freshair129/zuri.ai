// @req FR-084 — recovery preserves contract bytes and refuses unsupported formats.
// @spec ADR-035, BR-017
// @tested tests/unit/pipeline-handoff-recovery.test.js
import { readStoredHandoff } from './handoff-contract.js'

export function dependencyHandoffRecoveryErrors(snapshot) {
  const rows = snapshot?.tables?.dependency
  if (!Array.isArray(rows)) return ['DEPENDENCY_HANDOFF_INVALID']
  for (const row of rows) {
    // A pre-column snapshot has no field. Its legacy absence is additive SQL
    // NULL; a declared JSON null is corruption and must never become legacy.
    if (row.contractJson !== undefined && row.contractJson !== null && !readStoredHandoff(row.contractJson)) return ['DEPENDENCY_HANDOFF_INVALID']
  }
  return []
}
