// @req FR-247 — persist a `logger.exception()` result as one deduplicated
//   ErrorEvent row per fingerprint: a new fingerprint inserts with
//   occurrenceCount 1, a repeat increments the count and lastSeenAt, leaving
//   firstSeenAt untouched. An operator reads the list grouped by fingerprint
//   and can resolve one.
// @spec ADR-095 D1, SEC-009
// @tested tests/unit/error-events.test.js

const MAX_LIMIT = 200

const view = (row) => ({
  id: row.id,
  fingerprint: row.fingerprint,
  name: row.name,
  message: row.message,
  frames: JSON.parse(row.stackFramesJson || '[]'),
  occurrenceCount: row.occurrenceCount,
  firstSeenAt: row.firstSeenAt.toISOString(),
  lastSeenAt: row.lastSeenAt.toISOString(),
  correlationId: row.correlationId,
  route: row.route,
  resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  resolvedByPersonId: row.resolvedByPersonId,
})

/**
 * Persist one `logger.exception()` result. `parsed` is exactly what
 * `logger.exception(event, error, fields)` returns: `{ fingerprint, name,
 * message, frames }`; `correlationId`/`route` are optional context the caller
 * may already have to hand.
 */
export async function recordErrorEvent(db, parsed, { correlationId = null, route = null } = {}) {
  const { fingerprint, name, message, frames } = parsed
  const existing = await db.errorEvent.findUnique({ where: { fingerprint } })
  if (existing) {
    const row = await db.errorEvent.update({
      where: { fingerprint },
      data: { occurrenceCount: existing.occurrenceCount + 1, lastSeenAt: new Date(), correlationId, route },
    })
    return view(row)
  }
  const row = await db.errorEvent.create({
    data: { fingerprint, name, message, stackFramesJson: JSON.stringify(frames), correlationId, route },
  })
  return view(row)
}

/** Operator read: newest-active first, capped. Resolved rows sort after active ones. */
export async function listErrorEvents(db, { limit = 100, includeResolved = false } = {}) {
  const effective = Math.min(Math.max(1, limit), MAX_LIMIT)
  const rows = await db.errorEvent.findMany({
    where: includeResolved ? undefined : { resolvedAt: null },
    orderBy: [{ resolvedAt: 'asc' }, { lastSeenAt: 'desc' }],
    take: effective,
  })
  return rows.map(view)
}

/** An operator marks one fingerprint resolved; it stops counting as active. */
export async function resolveErrorEvent(db, id, resolvedByPersonId) {
  const row = await db.errorEvent.update({
    where: { id },
    data: { resolvedAt: new Date(), resolvedByPersonId },
  })
  return view(row)
}
