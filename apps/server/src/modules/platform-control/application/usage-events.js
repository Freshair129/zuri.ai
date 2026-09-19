// @req FR-248, FR-249 — record and read route/action usage, per person.
// @req NFR-023 — roll a raw UsageEvent row up into a person-free aggregate
//   once it is 90 days old.
// @spec ADR-095 D2, D3
// @tested tests/unit/usage-events.test.js
import { recordAudit } from '@/modules/project-manager/application/audit'

const ACTION_NAME = /^[\w.:@/-]{1,120}$/
const RAW_RETENTION_DAYS = 90
const ROLLUP_TRANSACTION_OPTIONS = Object.freeze({
  isolationLevel: 'Serializable',
  maxWait: 10_000,
  timeout: 120_000,
})
const MAX_ROLLUP_ATTEMPTS = 3

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

function rollupConflict(error) {
  return ['P2002', 'P2034'].includes(error?.code)
    || /database is locked|SQLITE_BUSY|SQLITE_LOCKED|could not serialize|serialization failure/i.test(error?.message || '')
}

function parseCompletedRollup(audit) {
  let payload
  try {
    payload = JSON.parse(audit.payloadJson || '{}')
  } catch {
    throw new Error('USAGE_ROLLUP_AUDIT_INVALID')
  }
  return {
    auditEventId: audit.id,
    rolledUpCount: payload.rolledUpCount || 0,
    groupCount: payload.groupCount || 0,
    alreadyRanToday: true,
  }
}

/**
 * Move every raw UsageEvent row older than `cutoffDays` into the day-grouped,
 * person-free rollup, then delete the rows that were rolled up. The read,
 * aggregate upsert, delete and audit are one serializable transaction so a
 * concurrent PostgreSQL caller must retry from a fresh snapshot rather than
 * counting the same raw id twice. `oncePerDay` is enabled by the scheduled
 * route; direct callers may process more than one run on a UTC day.
 */
export async function rollupUsageEvents(db, {
  now = new Date(),
  cutoffDays = RAW_RETENTION_DAYS,
  oncePerDay = false,
} = {}) {
  const cutoff = new Date(now.getTime() - cutoffDays * 24 * 60 * 60 * 1000)
  const dayStart = utcMidnight(now)
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

  for (let attempt = 0; attempt < MAX_ROLLUP_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        if (oncePerDay) {
          const already = await tx.auditEvent.findFirst({
            where: {
              entityType: 'USAGE_EVENT_ROLLUP',
              entityId: 'sweep',
              action: 'USAGE_EVENT_ROLLUP_COMPLETED',
              occurredAt: { gte: dayStart, lt: dayEnd },
            },
            orderBy: { occurredAt: 'desc' },
            select: { id: true, payloadJson: true },
          })
          if (already) return parseCompletedRollup(already)
        }

        const stale = await tx.usageEvent.findMany({
          where: { occurredAt: { lt: cutoff } },
          select: { id: true, kind: true, route: true, actionName: true, occurredAt: true },
        })
        const groups = new Map()
        for (const row of stale) {
          const date = utcMidnight(row.occurredAt)
          const target = row.kind === 'PAGE_VIEW' ? row.route : row.actionName
          const key = `${date.toISOString()}|${row.kind}|${target}`
          groups.set(key, { date, kind: row.kind, target, count: (groups.get(key)?.count || 0) + 1 })
        }
        for (const group of groups.values()) {
          await tx.usageEventRollup.upsert({
            where: { date_kind_target: { date: group.date, kind: group.kind, target: group.target } },
            create: group,
            update: { count: { increment: group.count } },
          })
        }
        if (stale.length) {
          const deleted = await tx.usageEvent.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } })
          if (deleted.count !== stale.length) {
            const error = new Error('USAGE_ROLLUP_CONCURRENT_DELETE')
            error.code = 'P2034'
            throw error
          }
        }
        const audit = await recordAudit(tx, {
          entityType: 'USAGE_EVENT_ROLLUP', entityId: 'sweep', action: 'USAGE_EVENT_ROLLUP_COMPLETED',
          payload: { rolledUpCount: stale.length, groupCount: groups.size, cutoff: cutoff.toISOString() },
        })
        return { auditEventId: audit.id, rolledUpCount: stale.length, groupCount: groups.size, alreadyRanToday: false }
      }, ROLLUP_TRANSACTION_OPTIONS)
    } catch (error) {
      if (!rollupConflict(error) || attempt === MAX_ROLLUP_ATTEMPTS - 1) throw error
      // The failed interactive transaction is already unusable. A short,
      // bounded delay lets the winning serializable transaction commit before
      // this attempt rereads its state; no sleep can make a failed tx safe.
      await new Promise((resolve) => setTimeout(resolve, 5 * (attempt + 1)))
    }
  }
  throw new Error('USAGE_ROLLUP_UNAVAILABLE')
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
