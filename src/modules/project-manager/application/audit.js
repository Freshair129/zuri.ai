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

export async function listAudit(db, { entityType, entityId, limit = 100 } = {}) {
  const where = {}
  if (entityType) where.entityType = entityType
  if (entityId) where.entityId = entityId
  const events = await db.auditEvent.findMany({
    where,
    orderBy: { occurredAt: 'desc' },
    take: Math.min(limit, 500),
  })
  return events.map((e) => ({ ...e, payload: safeParse(e.payloadJson) }))
}

export function safeParse(json, fallback = {}) {
  try {
    return JSON.parse(json)
  } catch {
    return fallback
  }
}
