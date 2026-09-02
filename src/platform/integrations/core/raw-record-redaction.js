// @req FR-022, FR-081 — the integration half of PDPA erasure: the verbatim provider
//   payload FR-081 keeps as replayable evidence.
// @spec SEC-001 — tenant-scoped: an external id alone never reaches another tenant's
//   raw records.
// Boundary: docs/domains/integration/CHARTER.md — "PDPA erasure wins over
//   replayability; the tombstone keeps the envelope".
// @tested tests/integration/crm-customer-erasure.test.js
//
// PDPA WINS OVER REPLAYABILITY; THE TOMBSTONE KEEPS THE ENVELOPE
// --------------------------------------------------------------
// This lane's standing rule is that raw payloads are evidence, persisted verbatim so a
// failed translation can never destroy what the provider actually sent. An erasure
// request is the one thing that outranks it: a LINE webhook payload contains the
// message text and the sender's provider subject, so leaving it intact would mean the
// erased person's words survive in full one join away from the redacted Customer.
//
// Deleting the row would be the other failure. Replay tooling reads this table to
// reconstruct what arrived; a missing row looks like an ingestion gap — a bug to chase
// — where a tombstone is a fact to read. So every envelope column stays exactly as it
// was (id, idempotencyKey, payloadHash, receivedAt, connectionId, provider, lane,
// entityType, externalId, receivedAt, processing state) and only `payloadJson` is
// replaced. The hash deliberately still describes the payload that WAS there: it is
// the evidence that this row is a redaction of a specific delivery, not a fabricated
// one, and recomputing it would erase that link too.

export const RAW_RECORD_ERASURE_REASON = 'PDPA_ERASURE'

/** The exact JSON an erased raw payload carries. */
export function rawRecordErasureTombstone(erasedAt) {
  return JSON.stringify({
    redacted: true,
    reason: RAW_RECORD_ERASURE_REASON,
    erasedAt: (erasedAt instanceof Date ? erasedAt : new Date(erasedAt ?? Date.now())).toISOString(),
  })
}

function isTombstoned(payloadJson) {
  if (typeof payloadJson !== 'string' || !payloadJson.startsWith('{')) return false
  try {
    const parsed = JSON.parse(payloadJson)
    return parsed?.redacted === true && parsed?.reason === RAW_RECORD_ERASURE_REASON
  } catch {
    return false
  }
}

/**
 * Replace the stored payload of every raw record in this tenant whose `externalId`
 * is one of `externalIds` with the erasure tombstone.
 *
 * Idempotent: a row already tombstoned is left byte-for-byte alone, so a second
 * erasure neither counts it again nor moves its `erasedAt`.
 *
 * @param {object} tx prisma client or transaction client — the caller owns the transaction
 * @param {{tenantId: string, externalIds: string[], now?: Date}} scope
 * @returns {Promise<{tombstonedRawRecords: number}>}
 */
export async function tombstoneRawRecordsForExternalIds(tx, { tenantId, externalIds, now } = {}) {
  if (!tenantId) throw new Error('tombstoneRawRecordsForExternalIds requires tenantId')
  const ids = Array.from(new Set((Array.isArray(externalIds) ? externalIds : []).filter(Boolean)))
  if (ids.length === 0) return { tombstonedRawRecords: 0 }

  const rows = await tx.rawExternalRecord.findMany({
    where: { tenantId, externalId: { in: ids } },
    select: { id: true, payloadJson: true },
  })

  const tombstone = rawRecordErasureTombstone(now ?? new Date())
  let tombstonedRawRecords = 0
  for (const row of rows) {
    if (isTombstoned(row.payloadJson)) continue
    await tx.rawExternalRecord.update({ where: { id: row.id }, data: { payloadJson: tombstone } })
    tombstonedRawRecords += 1
  }

  return { tombstonedRawRecords }
}
