import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { runRetentionSweep } from '@/modules/crm/retention-sweep-service'
import { bearerMatches } from '@/modules/platform-control/application/programme-usage-reports'

// @req FR-230 — the sweep (`retention-sweep-service.js`, TASK-ZAI-089) existed with
//   nothing in the running system ever calling it, so its "first production run
//   writes its audit event with counts per class" success criterion (TASK-ZAI-091)
//   was never true. This route is that missing callable entry point — a single
//   bounded unit of work invoked once a day by an external caller (the
//   standalone `scripts/server-retention-sweep-worker.mjs`, driven by the host's
//   own scheduler), following the shape `/api/line-oa/worker` and
//   `/api/platform/programme-usage-reports` already use: bearer compared before
//   any work happens, 401 on missing/wrong token, no body read and no browser
//   viewer resolved — this is deployment-authenticated, not person-authenticated.
// @spec ADR-091 D1, D2 — the sweep's own behaviour (which class it tombstones,
//   what it skips, what it reports) is unchanged; this route only gives it a
//   caller. The idempotency guard below is this route's own addition, layered
//   on top of (never instead of) the service's own row-level idempotency.
// @spec SEC-001 — deployment bearer, constant-time compare, fail closed.
// @tested tests/unit/crm-retention-sweep-route.test.js
export const dynamic = 'force-dynamic'

// A nightly batch job can afford minutes, unlike the LINE worker's ~1s cadence
// budget (that route carries no timeout of its own; a caller-side
// AbortSignal.timeout bounds the roundtrip instead). This is a ceiling on the
// route's OWN work, so a sweep stuck scanning an unexpectedly large Tenant set
// answers 503 and stops holding a connection open indefinitely, rather than
// running forever with nothing to show for it. It intentionally does not
// short-circuit finished work: runRetentionSweep already commits its updates
// per Tenant as it goes, so a timeout here reports "the whole run did not
// finish" without undoing what tenants before the timeout already had swept.
const SWEEP_TIMEOUT_MS = 10 * 60 * 1000

/** The [start, end) UTC-day window `now` falls in — the unit "once a day" is
 * measured against for the idempotency guard below. UTC rather than the
 * operator's local timezone: it is the one boundary every reader (this route,
 * a retry, a human checking `AuditEvent.occurredAt` later) computes the same
 * way with no configuration to drift out of sync. */
function utcDayWindow(now) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) }
}

function timeout(ms) {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error('RETENTION_SWEEP_TIMEOUT')), ms)
  })
}

export async function POST(request) {
  if (!bearerMatches(request.headers.get('authorization'), process.env.ZURI_RETENTION_SWEEP_TOKEN)) {
    return NextResponse.json({ error: 'RETENTION_SWEEP_CREDENTIAL_REQUIRED' }, { status: 401 })
  }
  const now = new Date()
  try {
    // A scheduler retry (its own request timed out but the first run already
    // finished server-side, or it simply fires twice) must not write a second
    // RETENTION_SWEEP_COMPLETED audit event for the same calendar day. Running
    // the sweep itself twice is harmless at the data layer — every candidate
    // the first run tombstoned is excluded from the second run's own query — but
    // a duplicate audit row is still a duplicate audit row, and ADR-091 D2's
    // "one audit event per run" reads as one per scheduled window, not one per
    // HTTP request. So this checks BEFORE calling the service, not after.
    const { start, end } = utcDayWindow(now)
    const already = await prisma.auditEvent.findFirst({
      where: { entityType: 'RETENTION_SWEEP', action: 'RETENTION_SWEEP_COMPLETED', occurredAt: { gte: start, lt: end } },
      orderBy: { occurredAt: 'desc' },
      select: { id: true, payloadJson: true },
    })
    if (already) {
      const payload = JSON.parse(already.payloadJson)
      return NextResponse.json({ auditEventId: already.id, countsByClass: payload.countsByClass, alreadyRanToday: true })
    }

    const result = await Promise.race([runRetentionSweep({ db: prisma, now }), timeout(SWEEP_TIMEOUT_MS)])
    // Counts per class only (ADR-070 D3) — the same shape the sweep's own audit
    // event carries, never a row of message/customer content.
    return NextResponse.json({ auditEventId: result.auditEventId, countsByClass: result.countsByClass, alreadyRanToday: false })
  } catch {
    return NextResponse.json({ error: 'RETENTION_SWEEP_UNAVAILABLE' }, { status: 503 })
  }
}
