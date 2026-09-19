// @req FR-014 — immutable audit event stream
// @req FR-198 — an event carries its own scope and the change it made, as
//   optional columns rather than only inside `payloadJson`.
// @spec SEC-003 — append-only; create-only API surface
// @spec BR-036, SDD-095 — scope is data a query can filter on, never only a
//   fact inside a free-form payload; nullable columns and optional parameters
//   are the shape that makes it additive rather than a retrofit.
// @spec ADR-080 D1 — every new parameter is optional with a null default, so
//   every existing caller of `recordAudit` keeps compiling and keeps writing
//   the same row it always did. This is the constraint that makes the change
//   safe: a column nobody is required to fill cannot break a caller that does
//   not know it exists.
// @tested tests/integration/project-core.test.js, tests/integration/plan-import.test.js,
//   tests/unit/access-history-service.test.js

/**
 * `entityType` is SCREAMING_SNAKE_CASE. Always.
 *
 * Not a style preference — three things already read it that way. The audit
 * console's filter list, its `ENUM_LIKE_VALUE` test and its underscore-to-space
 * rendering all assume it, so a PascalCase value renders raw and cannot be
 * filtered for. `activityWhere` in the project inventory read model matches
 * `{entityType, entityId}` pairs built from SCREAMING_SNAKE constants.
 *
 * And the deciding reason: an entityType is a **category**, not a model name.
 * SNAPSHOT, STEP_UP, AGENT_ACTION, PROJECT_FILE_MIGRATION and PLUGIN_AUTH_MAINTENANCE
 * name no Prisma model at all. A convention that spells the value like its model
 * can only cover the rows that have one, which is not a convention.
 *
 * This is a *different vocabulary* from the `entityType` on `RawExternalRecord`,
 * `ExternalEntityRef`, `ExternalRef` and `FileLink`. Those name a provider-side or
 * link-side entity kind (`listing`, `retail_price`) and are governed by their own
 * contracts. Renaming one because it shares a column name with this one would break
 * an integration wire format. The field name collides; the vocabularies do not meet.
 *
 * Enforced by `scripts/doc-preflight.mjs` (audit-entity-type), so a new spelling
 * fails the run rather than being discovered in the log months later.
 *
 * `db` may be the prisma client or a transaction client.
 *
 * @param {object} [scope]
 * @param {string|null} [scope.tenantId]   FR-198 — queryable scope column.
 * @param {string|null} [scope.businessId] FR-198 — queryable scope column.
 * @param {string|null} [scope.reason]     FR-198 — lifted out of `payload` onto
 *   its own column so an access review can filter and group on it directly.
 * @param {string|object|null} [scope.beforeJson] FR-198 — state before the
 *   change. A plain object is stringified; a string is stored as given.
 * @param {string|object|null} [scope.afterJson]  FR-198 — state after the change.
 * @param {string|null} [scope.requestId]  FR-198 — correlation, unused today.
 * @param {string|null} [scope.sessionId]  FR-198 — correlation, unused today.
 */
export async function recordAudit(db, {
  entityType, entityId, action, payload = {}, actorType = 'LOCAL_USER', actorId = null,
  tenantId = null, businessId = null, reason = null, beforeJson = null, afterJson = null,
  requestId = null, sessionId = null,
}) {
  return db.auditEvent.create({
    data: {
      entityType,
      entityId,
      action,
      payloadJson: JSON.stringify(payload),
      actorType,
      actorId,
      tenantId,
      businessId,
      reason,
      beforeJson: stringifyOrNull(beforeJson),
      afterJson: stringifyOrNull(afterJson),
      requestId,
      sessionId,
    },
  })
}

function stringifyOrNull(value) {
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : JSON.stringify(value)
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
export async function listAudit(db, { entityType, entityId, limit = 100, withEntityTypes = false } = {}) {
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
    ...(withEntityTypes ? { entityTypes: await listAuditEntityTypes(db) } : {}),
  }
}

/**
 * @req FR-014 — every entityType present in the log, with how many rows carry it.
 *
 * Deliberately **unfiltered**: it counts the whole table, not the current
 * `where`. A facet that narrowed with its own filter would collapse to the one
 * option already chosen, and there would be no way back to the others.
 *
 * Counting the whole table is also what makes the numbers worth showing next to
 * a window that is capped at `AUDIT_MAX_LIMIT`: an operator looking at 200 rows
 * can still see that 4,000 PERSON events exist. `groupBy` on `entityType` reads
 * the leading column of the `(entityType, entityId)` index rather than the rows.
 *
 * Ordered here rather than by the database, by codepoint. SQLite's binary
 * collation and Postgres's put `WORK_ITEM` and `WORKSTREAM` in opposite orders,
 * because they disagree about where `_` sorts. This list is read by a human
 * scanning a dropdown, so it must not depend on which engine is underneath.
 */
export async function listAuditEntityTypes(db) {
  const groups = await db.auditEvent.groupBy({
    by: ['entityType'],
    _count: { entityType: true },
  })
  return groups
    .map((g) => ({ value: g.entityType, count: g._count.entityType }))
    .sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
}

export function safeParse(json, fallback = {}) {
  try {
    return JSON.parse(json)
  } catch {
    return fallback
  }
}
