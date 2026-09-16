// @req FR-249, NFR-023 — the missing callable entry point for the 90-day
//   rollup: a bounded, deployment-authenticated unit of work invoked once a
//   day by an external scheduler, following the shape
//   `/api/crm/retention-sweep` already established — bearer compared before
//   any work happens, 401 on a missing/wrong token, deployment-authenticated
//   rather than person-authenticated.
// @spec ADR-095 D3; SEC-001; ADR-057
// @tested tests/unit/usage-events.test.js
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { rollupUsageEvents } from '@/modules/platform-control/application/usage-events'
import { bearerMatches } from '@/modules/platform-control/application/programme-usage-reports'

export const dynamic = 'force-dynamic'

function utcDayWindow(now) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) }
}

export async function POST(request) {
  if (!bearerMatches(request.headers.get('authorization'), process.env.ZURI_USAGE_ROLLUP_TOKEN)) {
    return NextResponse.json({ error: 'USAGE_ROLLUP_CREDENTIAL_REQUIRED' }, { status: 401 })
  }
  const now = new Date()
  try {
    // Same once-a-day idempotency guard as the retention sweep: a scheduler
    // retry must not write a second audit event for a window already swept —
    // running the rollup twice is otherwise harmless (a second pass over an
    // already-rolled-up row finds nothing stale to move), but a duplicate
    // audit row is still a duplicate audit row.
    const { start, end } = utcDayWindow(now)
    const already = await prisma.auditEvent.findFirst({
      where: { entityType: 'USAGE_EVENT_ROLLUP', action: 'USAGE_EVENT_ROLLUP_COMPLETED', occurredAt: { gte: start, lt: end } },
      orderBy: { occurredAt: 'desc' },
      select: { id: true, payloadJson: true },
    })
    if (already) {
      const payload = JSON.parse(already.payloadJson)
      return NextResponse.json({ auditEventId: already.id, rolledUpCount: payload.rolledUpCount, groupCount: payload.groupCount, alreadyRanToday: true })
    }
    const result = await rollupUsageEvents(prisma, { now })
    return NextResponse.json({ ...result, alreadyRanToday: false })
  } catch {
    return NextResponse.json({ error: 'USAGE_ROLLUP_UNAVAILABLE' }, { status: 503 })
  }
}
