// @req FR-230 — the Agent-owned AGENT_TRACE_EVENT slice of ADR-091 D2.
// @spec SEC-031, SEC-001, ADR-091 D2
// @tested tests/integration/agent-trace-retention-sweep.test.js, tests/unit/retention-sweeper-job-statuses.test.js
//
// Candidate turns are enumerated outside transactions. Each eligible turn is
// redacted through redactTraceTurn's own transaction. If a turn fails, that
// Tenant stops there: prior committed turns stay redacted, unprocessed turns
// stay intact, the audit names { tenantId, code }, and later Tenants still run.

import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { getEffectiveRetentionWindowDays } from '@/modules/crm/retention-override-service'
import { redactTraceTurn, retentionTombstoneKey } from './execution-trace'

const CLASS = 'AGENT_TRACE_EVENT'
export const AGENT_TRACE_RETENTION_AUDIT_ENTITY = 'AGENT_TRACE_RETENTION_SWEEP'
export const AGENT_TRACE_RETENTION_AUDIT_ACTION = 'AGENT_TRACE_RETENTION_SWEEP_COMPLETED'
export const AGENT_TRACE_RETENTION_CHUNK_SIZE = 100

// Intentionally local and equal to the CRM and Integration sweep subsets.
export const AGENT_TRACE_NON_TERMINAL_JOB_STATUSES = Object.freeze([
  'QUEUED', 'CLAIMED', 'READY', 'SENDING', 'ACCEPTED', 'UNKNOWN',
])

const OPEN_ERASURE_KINDS = Object.freeze([
  'MEMORY_THREAD_ERASURE_PENDING', 'MEMORY_THREAD_ERASURE_ACKNOWLEDGED',
])

function safeFailureCode(error) {
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(error?.code || '') ? error.code : 'TENANT_SWEEP_FAILED'
}

function turnKey({ businessId, turnId }) {
  return `${businessId}\u0000${turnId}`
}

async function sweepTenantPages(db, { tenantId, now, counts }) {
  const windowDays = await getEffectiveRetentionWindowDays({ tenantId, dataClass: CLASS, db })
  // createdAt is persistence age. occurredAt can intentionally be future-dated
  // (for example MEMORY_THREAD_ERASURE_DEFERRED's next retry), so it is not a
  // safe clock for deciding when retained model-input content expires.
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000)
  let after = null

  while (true) {
    const where = {
      tenantId,
      ...(after ? { OR: [
        { businessId: { gt: after.businessId } },
        { businessId: after.businessId, turnId: { gt: after.turnId } },
      ] } : {}),
    }
    // `having` puts the grouped field first, then its aggregate filter. Prisma
    // 5.22's groupBy types also require orderBy with take and restrict its fields
    // to `by`; these two order keys are both grouping fields.
    const turns = await db.agentTraceEvent.groupBy({
      by: ['businessId', 'turnId'],
      where,
      having: { createdAt: { _max: { lt: cutoff } } },
      orderBy: [{ businessId: 'asc' }, { turnId: 'asc' }],
      take: AGENT_TRACE_RETENTION_CHUNK_SIZE,
      _max: { createdAt: true },
    })
    if (turns.length === 0) break

    const turnPairs = turns.map(({ businessId, turnId }) => ({ businessId, turnId }))
    // Fetch each page's skip state once, regardless of its number of turns.
    const [tombstones, jobs, erasureEvents] = await Promise.all([
      db.agentTraceEvent.findMany({
        where: {
          tenantId,
          kind: 'RETENTION_TOMBSTONE',
          OR: turnPairs.map(({ businessId, turnId }) => ({
            businessId, turnId, idempotencyKey: retentionTombstoneKey(turnId),
          })),
        },
        select: { businessId: true, turnId: true },
      }),
      db.lineConversationJob.findMany({
        where: {
          tenantId,
          OR: turnPairs.map(({ businessId, turnId }) => ({ businessId, id: turnId })),
        },
        select: { id: true, businessId: true, status: true, memoryDeliveryState: true },
      }),
      db.agentTraceEvent.findMany({
        where: {
          tenantId,
          kind: { in: OPEN_ERASURE_KINDS },
          OR: turnPairs.map(({ businessId, turnId }) => ({ businessId, turnId })),
        },
        select: { businessId: true, turnId: true, kind: true },
      }),
    ])

    const tombstoned = new Set(tombstones.map(turnKey))
    const jobByTurn = new Map(jobs.map(job => [turnKey({ businessId: job.businessId, turnId: job.id }), job]))
    const erasureKindsByTurn = new Map()
    for (const event of erasureEvents) {
      const key = turnKey(event)
      if (!erasureKindsByTurn.has(key)) erasureKindsByTurn.set(key, new Set())
      erasureKindsByTurn.get(key).add(event.kind)
    }

    for (const turn of turns) {
      const key = turnKey(turn)
      if (tombstoned.has(key)) continue

      const job = jobByTurn.get(key)
      if (job && AGENT_TRACE_NON_TERMINAL_JOB_STATUSES.includes(job.status)) {
        counts.skippedNonTerminalJob += 1
        continue
      }
      // A terminal RECORDED job may still have a retryable MSP memory delivery.
      // The delivery worker and backup recovery consume its pending checkpoint.
      if (job?.memoryDeliveryState === 'PENDING') {
        counts.skippedPendingMemoryDelivery += 1
        continue
      }

      // FAILED is deliberately not a close marker. Only a matching
      // ACKNOWLEDGED record resolves a PENDING MSP erasure request.
      const erasureKinds = erasureKindsByTurn.get(key)
      if (erasureKinds?.has('MEMORY_THREAD_ERASURE_PENDING')
        && !erasureKinds.has('MEMORY_THREAD_ERASURE_ACKNOWLEDGED')) {
        counts.skippedOpenErasure += 1
        continue
      }

      const result = await redactTraceTurn(db, {
        scope: { tenantId, businessId: turn.businessId }, turnId: turn.turnId, now,
        reason: 'RETENTION_EXPIRED',
      })
      if (result.alreadyRedacted) continue
      counts.redactedTurns += 1
      counts.redactedEvents += result.redactedCount
    }

    const last = turns[turns.length - 1]
    after = { businessId: last.businessId, turnId: last.turnId }
    if (turns.length < AGENT_TRACE_RETENTION_CHUNK_SIZE) break
  }
  return counts
}

/** Sweep one Tenant without writing a run-level audit event. */
export async function sweepAgentTraceTurnsForTenant(db, { tenantId, now = new Date() } = {}) {
  const counts = { redactedTurns: 0, redactedEvents: 0, skippedNonTerminalJob: 0,
    skippedPendingMemoryDelivery: 0, skippedOpenErasure: 0 }
  try {
    await sweepTenantPages(db, { tenantId, now, counts })
  } catch (error) {
    // Redactions committed by earlier per-turn transactions stay due and
    // idempotent; later turns for this Tenant are left for the next invocation.
    return { ...counts, tenantFailure: { tenantId, code: safeFailureCode(error) } }
  }
  return counts
}

/** Run the Agent-owned trace payload sweep across all Tenants. */
export async function runAgentTraceRetentionSweep({ db = prisma, now = new Date() } = {}) {
  const totals = { redactedTurns: 0, redactedEvents: 0, skippedNonTerminalJob: 0,
    skippedPendingMemoryDelivery: 0, skippedOpenErasure: 0 }
  const tenantFailures = []
  const tenants = await db.tenant.findMany({ select: { id: true }, orderBy: { id: 'asc' } })
  for (const tenant of tenants) {
    const counts = await sweepAgentTraceTurnsForTenant(db, { tenantId: tenant.id, now })
    for (const key of Object.keys(totals)) totals[key] += counts[key]
    if (counts.tenantFailure) tenantFailures.push(counts.tenantFailure)
  }

  const countsByClass = {
    [CLASS]: { ...totals, ...(tenantFailures.length ? { tenantFailures } : {}) },
  }
  const event = await recordAudit(db, {
    entityType: AGENT_TRACE_RETENTION_AUDIT_ENTITY,
    entityId: `agent-trace-retention:${now.toISOString()}`,
    action: AGENT_TRACE_RETENTION_AUDIT_ACTION,
    actorType: 'SYSTEM',
    payload: { ranAt: now.toISOString(), countsByClass },
  })
  return { auditEventId: event.id, countsByClass, alreadyRanToday: false }
}
