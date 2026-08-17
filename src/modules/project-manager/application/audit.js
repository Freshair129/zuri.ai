// @req FR-014 — immutable audit event stream
// @spec SEC-003 — append-only; create-only API surface
// @tested tests/integration/project-core.test.js, tests/integration/plan-import.test.js
// `db` may be the prisma client or a transaction client.

export async function recordAudit(db, { entityType, entityId, action, payload = {}, actorType = 'LOCAL_USER', actorId = null }) {
  return db.auditEvent.create({
    data: {
      entityType,
      entityId,
      action,
      payloadJson: JSON.stringify(payload),
      actorType,
      actorId,
    },
  })
}

/** Nothing may ask for more than this, however large a `limit` it passes. */
export const AUDIT_MAX_LIMIT = 500

/**
 * @req FR-014 — the audit browser states when it is showing a window rather
 * than the whole stream.
 * @returns {Promise<{events: object[], limit: number, truncated: boolean}>}
 *
 * An audit log is the one surface where a silently short list is worst: it is
 * consulted precisely to answer "did this happen?", and an unmarked truncation
 * turns "not in the visible 200" into "never happened". The cap stays — one
 * request must not stream the whole table — but it now says so.
 */
export async function listAudit(db, { entityType, entityId, limit = 100 } = {}) {
  const where = {}
  if (entityType) where.entityType = entityType
  if (entityId) where.entityId = entityId
  const effective = Math.min(limit, AUDIT_MAX_LIMIT)
  // One more than we will return: enough to know a next row exists, without
  // counting a table that only grows.
  const rows = await db.auditEvent.findMany({
    where,
    orderBy: { occurredAt: 'desc' },
    take: effective + 1,
  })
  return {
    events: rows.slice(0, effective).map((e) => ({ ...e, payload: safeParse(e.payloadJson) })),
    limit: effective,
    truncated: rows.length > effective,
  }
}

export function safeParse(json, fallback = {}) {
  try {
    return JSON.parse(json)
  } catch {
    return fallback
  }
}
