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
//   payload (`event.message.id`), for this tenant's LINE message records only.
//   The lookup is bounded, because it runs inside erasure's Serializable transaction:
//   only `LINE_MESSAGE` records (the [tenantId, entityType] index), only those
//   received within an hour of the erased messages' own write times, in chunks of 50
//   ids sorted by time. Follow-up: an indexed provider-message-id column on the raw
//   record (or a retried post-commit step) would replace this text scan.
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

// The entity type the LINE normalizer gives a `message` event (line-oa-webhook.js
// `lineEntityType`), and how far a raw record's `receivedAt` (set at ingest) may lie
// from its Message's `createdAt`: the evidence row is written just before admission.
const LINE_MESSAGE_ENTITY_TYPE = 'LINE_MESSAGE'
const RECEIVED_WINDOW_MS = 60 * 60 * 1000
const CHUNK = 50

/**
 * The LINE message raw records of this tenant whose payload is the webhook event of
 * one of `lineMessages` (`{id, createdAt}`: the provider message id and when its
 * Message was written). The payload is stored canonically (`stableStringify`:
 * sorted keys, no whitespace), so `"id":"<messageId>"` narrows the read by text; the
 * row is taken only when its parsed `event.message.id` is exactly that id — the text
 * match never decides. Each read is bounded to `LINE_MESSAGE` records received
 * within an hour of its chunk's messages; a message with no time is not looked up.
 */
async function findLineMessageRawRecords(tx, { tenantId, lineMessages }) {
  const times = new Map()
  for (const message of lineMessages) {
    const at = message?.createdAt instanceof Date ? message.createdAt : new Date(message?.createdAt ?? NaN)
    if (typeof message?.id !== 'string' || !message.id || Number.isNaN(at.getTime())) continue
    const known = times.get(message.id)
    times.set(message.id, known ? [Math.min(known[0], at.getTime()), Math.max(known[1], at.getTime())] : [at.getTime(), at.getTime()])
  }
  const ordered = [...times.entries()].sort((a, b) => a[1][0] - b[1][0])
  const rows = []
  for (let offset = 0; offset < ordered.length; offset += CHUNK) {
    const chunk = ordered.slice(offset, offset + CHUNK)
    const wanted = new Set(chunk.map(([id]) => id))
    const from = new Date(Math.min(...chunk.map(([, [low]]) => low)) - RECEIVED_WINDOW_MS)
    const to = new Date(Math.max(...chunk.map(([, [, high]]) => high)) + RECEIVED_WINDOW_MS)
    const found = await tx.rawExternalRecord.findMany({
      where: { tenantId, entityType: LINE_MESSAGE_ENTITY_TYPE, provider: LINE_OA_PROVIDER_CODE,
        receivedAt: { gte: from, lte: to },
        OR: chunk.map(([id]) => ({ payloadJson: { contains: `"id":${JSON.stringify(id)}` } })) },
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
 * is one of `externalIds`, and every LINE message raw record whose webhook event is
 * one of `lineMessages` (see `findLineMessageRawRecords`), with the erasure tombstone.
 * A row reached both ways is tombstoned and counted once.
 *
 * Idempotent: a row already tombstoned is left byte-for-byte alone, so a second
 * erasure neither counts it again nor moves its `erasedAt`.
 *
 * @param {object} tx prisma client or transaction client — the caller owns the transaction
 * @param {{tenantId: string, externalIds: string[], lineMessages?: {id: string, createdAt: Date}[], now?: Date}} scope
 * @returns {Promise<{tombstonedRawRecords: number}>}
 */
export async function tombstoneRawRecordsForExternalIds(tx, { tenantId, externalIds, lineMessages, now } = {}) {
  if (!tenantId) throw new Error('tombstoneRawRecordsForExternalIds requires tenantId')
  const ids = Array.from(new Set((Array.isArray(externalIds) ? externalIds : []).filter(Boolean)))
  const messages = Array.isArray(lineMessages) ? lineMessages : []
  if (ids.length === 0 && messages.length === 0) return { tombstonedRawRecords: 0 }

  const byKey = ids.length
    ? await tx.rawExternalRecord.findMany({
      where: { tenantId, externalId: { in: ids } },
      select: { id: true, payloadJson: true },
    })
    : []
  const byPayload = messages.length ? await findLineMessageRawRecords(tx, { tenantId, lineMessages: messages }) : []
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
