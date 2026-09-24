import { createHash, randomUUID } from 'node:crypto'

// Local atomic evidence written in the SAME unit of work as a business effect:
//   • ScmOperationReceipt — durable mutation identity (idempotency) + the exact
//     response, so a caller that lost the response can look the outcome up
//     instead of re-sending a mutation;
//   • ScmAuditEvent      — the AuditEvent columns, atomic with the effect;
//   • ScmOutbox          — one row per committed fact for a future idempotent relay
//     to the core audit view. Never written for a rolled-back unit (same tx).
// SCM does not become the owner of the global AuditEvent/PipelineRun ledger.

export const stableJson = (value) => JSON.stringify(sortKeys(value))
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]))
  }
  return value
}
export const requestHash = (value) => createHash('sha256').update(stableJson(value)).digest('hex')

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/

export function assertIdempotencyKey(key) {
  if (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key)) {
    throw Object.assign(new Error('Idempotency-Key header (8–200 of A-Z a-z 0-9 . _ : -) is required for SCM mutations'), { status: 400, code: 'SCM_IDEMPOTENCY_KEY_REQUIRED', retryable: false })
  }
  return key
}

/** The existing receipt for this scope+key, or null. */
export function findReceipt(sql, { tenantId, businessId, action, actorId, idempotencyKey }) {
  return sql.get(
    'SELECT * FROM ScmOperationReceipt WHERE tenantId = ? AND businessId = ? AND action = ? AND actorId = ? AND idempotencyKey = ?',
    tenantId, businessId, action, actorId, idempotencyKey,
  ) ?? null
}

/**
 * Replay decision for an incoming mutation: same key + same payload → the stored
 * outcome; same key + different payload/target → conflict. Called INSIDE the unit
 * of work, after the caller's CURRENT authority was checked (a key is never a
 * read capability).
 */
export function replayOrConflict(existing, hash, targetId) {
  if (!existing) return null
  if (existing.requestHash !== hash || (existing.targetId ?? null) !== (targetId ?? null)) {
    throw Object.assign(new Error('Idempotency-Key was already used for a different request'), { status: 409, code: 'SCM_IDEMPOTENCY_KEY_CONFLICT', retryable: false })
  }
  return { ...JSON.parse(existing.responseJson), replayed: true, operation: operationDto(existing) }
}

export function operationDto(row) {
  return { id: row.id, action: row.action, idempotencyKey: row.idempotencyKey, status: row.status, targetId: row.targetId, affected: JSON.parse(row.affectedJson), committedAt: row.createdAt }
}

export function writeReceipt(sql, { tenantId, businessId, action, actorId, idempotencyKey, hash, targetId, response, affected, now }) {
  const row = { id: randomUUID(), tenantId, businessId, action, actorId, idempotencyKey, requestHash: hash, targetId: targetId ?? null, status: 'COMMITTED', responseJson: JSON.stringify(response), affectedJson: JSON.stringify(affected), createdAt: now }
  sql.run(
    'INSERT INTO ScmOperationReceipt (id, tenantId, businessId, action, actorId, idempotencyKey, requestHash, targetId, status, responseJson, affectedJson, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    row.id, row.tenantId, row.businessId, row.action, row.actorId, row.idempotencyKey, row.requestHash, row.targetId, row.status, row.responseJson, row.affectedJson, row.createdAt,
  )
  return operationDto(row)
}

export function recordAudit(sql, { entityType, entityId, action, actorId, tenantId, businessId, requestId, payload, now }) {
  const id = randomUUID()
  sql.run(
    'INSERT INTO ScmAuditEvent (id, entityType, entityId, action, payloadJson, actorType, actorId, occurredAt, tenantId, businessId, requestId) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    id, entityType, entityId, action, JSON.stringify(payload ?? {}), 'DELEGATED_USER', actorId ?? null, now, tenantId ?? null, businessId ?? null, requestId ?? null,
  )
  return id
}

export function enqueueOutbox(sql, { topic, aggregateType, aggregateId, aggregateVersion = null, payload, now }) {
  sql.run(
    'INSERT INTO ScmOutbox (id, topic, aggregateType, aggregateId, aggregateVersion, payloadJson, createdAt, deliveredAt) VALUES (?,?,?,?,?,?,?,NULL)',
    randomUUID(), topic, aggregateType, aggregateId, aggregateVersion, JSON.stringify(payload ?? {}), now,
  )
}
