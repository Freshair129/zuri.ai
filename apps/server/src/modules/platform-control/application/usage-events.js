// @req FR-248, FR-249 — record and read route/action usage, per person.
// @req NFR-023 — roll a raw UsageEvent row up into a person-free aggregate
//   once it is 90 days old.
// @spec ADR-095 D2, D3
// @tested tests/unit/usage-events.test.js
import { recordAudit } from '@/modules/project-manager/application/audit'

const ACTION_NAME = /^[\w.:@/-]{1,120}$/
const RAW_RETENTION_DAYS = 90

/**
 * Record one usage event. `kind` decides which of `route`/`actionName` is
 * required and which must be absent — a PAGE_VIEW never carries an
 * actionName and an ACTION never carries a route, so the two levels this
 * model covers stay distinguishable by shape, not only by the `kind` string.
 */
export async function recordUsageEvent(db, { kind, route, actionName, personId, sessionId } = {}) {
  if (kind !== 'PAGE_VIEW' && kind !== 'ACTION') throw httpError(400, 'USAGE_EVENT_KIND_INVALID')
  if (!personId) throw httpError(400, 'USAGE_EVENT_PERSON_REQUIRED')
  if (kind === 'PAGE_VIEW') {
    if (typeof route !== 'string' || !route.startsWith('/') || route.length > 300) throw httpError(400, 'USAGE_EVENT_ROUTE_INVALID')
    if (actionName != null) throw httpError(400, 'USAGE_EVENT_ROUTE_CARRIES_NO_ACTION_NAME')
  } else {
    if (typeof actionName !== 'string' || !ACTION_NAME.test(actionName)) throw httpError(400, 'USAGE_EVENT_ACTION_NAME_INVALID')
    if (route != null) throw httpError(400, 'USAGE_EVENT_ACTION_CARRIES_NO_ROUTE')
  }
  return db.usageEvent.create({
    data: { kind, route: kind === 'PAGE_VIEW' ? route : null, actionName: kind === 'ACTION' ? actionName : null, personId, sessionId: sessionId || null },
  })
}

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

const utcMidnight = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))

/**
 * Move every raw UsageEvent row older than `cutoffDays` into the day-grouped,
 * person-free rollup, then delete the rows that were rolled up. One audit
 * event per call, naming exactly the counts this run produced (same
 * discipline the CRM retention sweep already follows).
 */
export async function rollupUsageEvents(db, { now = new Date(), cutoffDays = RAW_RETENTION_DAYS } = {}) {
  const cutoff = new Date(now.getTime() - cutoffDays * 24 * 60 * 60 * 1000)
  const stale = await db.usageEvent.findMany({ where: { occurredAt: { lt: cutoff } }, select: { id: true, kind: true, route: true, actionName: true, occurredAt: true } })
  const groups = new Map()
  for (const row of stale) {
    const date = utcMidnight(row.occurredAt)
    const target = row.kind === 'PAGE_VIEW' ? row.route : row.actionName
    const key = `${date.toISOString()}|${row.kind}|${target}`
    groups.set(key, { date, kind: row.kind, target, count: (groups.get(key)?.count || 0) + 1 })
  }
  for (const group of groups.values()) {
    const existing = await db.usageEventRollup.findUnique({ where: { date_kind_target: { date: group.date, kind: group.kind, target: group.target } } })
    if (existing) {
      await db.usageEventRollup.update({ where: { id: existing.id }, data: { count: existing.count + group.count } })
    } else {
      await db.usageEventRollup.create({ data: group })
    }
  }
  if (stale.length) await db.usageEvent.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } })
  const audit = await recordAudit(db, {
    entityType: 'USAGE_EVENT_ROLLUP', entityId: 'sweep', action: 'USAGE_EVENT_ROLLUP_COMPLETED',
    payload: { rolledUpCount: stale.length, groupCount: groups.size, cutoff: cutoff.toISOString() },
  })
  return { auditEventId: audit.id, rolledUpCount: stale.length, groupCount: groups.size }
}

/**
 * Operator read: route and action counts, split into the last 90 days'
 * per-person breakdown (all this codebase ever has a person for) and the
 * lifetime total (recent + whatever the rollup has already absorbed).
 */
export async function listUsageBreakdown(db, { kind } = {}) {
  if (kind !== 'PAGE_VIEW' && kind !== 'ACTION') throw httpError(400, 'USAGE_EVENT_KIND_INVALID')
  const targetField = kind === 'PAGE_VIEW' ? 'route' : 'actionName'
  const recentByTarget = await db.usageEvent.groupBy({ by: [targetField], where: { kind }, _count: { _all: true } })
  const recentByTargetPerson = await db.usageEvent.groupBy({ by: [targetField, 'personId'], where: { kind }, _count: { _all: true } })
  const rolledUp = await db.usageEventRollup.groupBy({ by: ['target'], where: { kind }, _sum: { count: true } })

  const personIds = [...new Set(recentByTargetPerson.map((r) => r.personId))]
  const people = personIds.length ? await db.person.findMany({ where: { id: { in: personIds } }, select: { id: true, code: true, displayName: true } }) : []
  const personLabel = new Map(people.map((p) => [p.id, p.displayName || p.code]))

  const targets = new Set([
    ...recentByTarget.map((r) => r[targetField]),
    ...rolledUp.map((r) => r.target),
  ].filter(Boolean))

  return [...targets].map((target) => {
    const recentCount = recentByTarget.find((r) => r[targetField] === target)?._count._all || 0
    const rolledUpCount = rolledUp.find((r) => r.target === target)?._sum.count || 0
    const byPerson = recentByTargetPerson
      .filter((r) => r[targetField] === target)
      .map((r) => ({ personId: r.personId, label: personLabel.get(r.personId) || r.personId, count: r._count._all }))
      .sort((a, b) => b.count - a.count)
    return { target, recentCount, rolledUpCount, totalCount: recentCount + rolledUpCount, byPerson }
  }).sort((a, b) => b.totalCount - a.totalCount)
}
