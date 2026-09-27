// @req FR-022, FR-081 — the integration half of PDPA erasure: the verbatim provider
//   payload FR-081 keeps as replayable evidence.
// @spec SEC-001 — tenant-scoped: an external id alone never reaches another tenant's
//   raw records.
// Boundary: docs/domains/integration/CHARTER.md — "PDPA erasure wins over
//   replayability; the tombstone keeps the envelope".
// @tested tests/integration/crm-customer-erasure.test.js
// @req FR-022 — a LINE message event is keyed by its `webhookEventId` whenever LINE
//   sends one (line-oa-webhook.js `externalEventId`), and no business row stores that
//   id, so an erased message's raw payload is also found by the message id INSIDE the
//   payload (`event.message.id`), for this tenant's LINE records only.
// @tested tests/integration/identity-erase-speaker-events.test.js
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

import { LINE_OA_PROVIDER_CODE } from './integration-registry'

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
 * The LINE raw records of this tenant whose payload is the webhook event of one of
 * `lineMessageIds`. The payload is stored canonically (`stableStringify`: sorted
 * keys, no whitespace), so `"id":"<messageId>"` narrows the read by text; the row
 * is taken only when its parsed `event.message.id` is exactly that id — the text
 * match never decides. Bounded per call by the ids given (chunked).
 */
async function findLineMessageRawRecords(tx, { tenantId, lineMessageIds }) {
  const ids = Array.from(new Set(lineMessageIds.filter((id) => typeof id === 'string' && id)))
  const wanted = new Set(ids)
  const rows = []
  for (let offset = 0; offset < ids.length; offset += 50) {
    const chunk = ids.slice(offset, offset + 50)
    const found = await tx.rawExternalRecord.findMany({
      where: { tenantId, provider: LINE_OA_PROVIDER_CODE,
        OR: chunk.map((id) => ({ payloadJson: { contains: `"id":${JSON.stringify(id)}` } })) },
      select: { id: true, payloadJson: true },
    })
    for (const row of found) {
      let parsed = null
      try { parsed = JSON.parse(row.payloadJson) } catch { parsed = null }
      const messageId = parsed?.event?.message?.id
      if (typeof messageId === 'string' && wanted.has(messageId)) rows.push(row)
    }
  }
  return rows
}

/**
 * Replace the stored payload of every raw record in this tenant whose `externalId`
 * is one of `externalIds`, and every LINE raw record whose webhook event is one of
 * `lineMessageIds` (see `findLineMessageRawRecords`), with the erasure tombstone.
 * A row reached both ways is tombstoned and counted once.
 *
 * Idempotent: a row already tombstoned is left byte-for-byte alone, so a second
 * erasure neither counts it again nor moves its `erasedAt`.
 *
 * @param {object} tx prisma client or transaction client — the caller owns the transaction
 * @param {{tenantId: string, externalIds: string[], lineMessageIds?: string[], now?: Date}} scope
 * @returns {Promise<{tombstonedRawRecords: number}>}
 */
export async function tombstoneRawRecordsForExternalIds(tx, { tenantId, externalIds, lineMessageIds, now } = {}) {
  if (!tenantId) throw new Error('tombstoneRawRecordsForExternalIds requires tenantId')
  const ids = Array.from(new Set((Array.isArray(externalIds) ? externalIds : []).filter(Boolean)))
  const messageIds = Array.isArray(lineMessageIds) ? lineMessageIds : []
  if (ids.length === 0 && messageIds.length === 0) return { tombstonedRawRecords: 0 }

  const byKey = ids.length
    ? await tx.rawExternalRecord.findMany({
      where: { tenantId, externalId: { in: ids } },
      select: { id: true, payloadJson: true },
    })
    : []
  const byPayload = messageIds.length ? await findLineMessageRawRecords(tx, { tenantId, lineMessageIds: messageIds }) : []
  const rows = [...new Map([...byKey, ...byPayload].map((row) => [row.id, row])).values()]

  const tombstone = rawRecordErasureTombstone(now ?? new Date())
  let tombstonedRawRecords = 0
  for (const row of rows) {
    if (isTombstoned(row.payloadJson)) continue
    await tx.rawExternalRecord.update({ where: { id: row.id }, data: { payloadJson: tombstone } })
    tombstonedRawRecords += 1
  }

  return { tombstonedRawRecords }
}
