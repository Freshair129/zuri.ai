import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { runAgentTraceRetentionSweep, AGENT_TRACE_RETENTION_AUDIT_ACTION, AGENT_TRACE_RETENTION_AUDIT_ENTITY } from '@/modules/agent/trace-retention-sweep-service'
import { bearerMatches } from '@/modules/platform-control/application/programme-usage-reports'

// @req FR-230 — deployment-authenticated trigger for Agent trace retention;
//   checks the shared bearer before any database work.
// @spec SEC-001, SEC-031, ADR-091 D2
// @tested tests/unit/agent-trace-retention-sweep-route.test.js
export const dynamic = 'force-dynamic'

const SWEEP_TIMEOUT_MS = 10 * 60 * 1000

function utcDayWindow(now) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) }
}

function timeout(ms) {
  return new Promise((_resolve, reject) => setTimeout(() => reject(new Error('RETENTION_SWEEP_TIMEOUT')), ms))
}

export async function POST(request) {
  if (!bearerMatches(request.headers.get('authorization'), process.env.ZURI_RETENTION_SWEEP_TOKEN)) {
    return NextResponse.json({ error: 'RETENTION_SWEEP_CREDENTIAL_REQUIRED' }, { status: 401 })
  }
  const query = new URL(request.url).searchParams
  if ([...query.keys()].some(key => key !== 'dry_run') || query.getAll('dry_run').length > 1
    || (query.has('dry_run') && !['true', 'false'].includes(query.get('dry_run')))) {
    return NextResponse.json({ error: 'RETENTION_SWEEP_REQUEST_INVALID' }, { status: 400 })
  }
  const dryRun = query.get('dry_run') === 'true'
  const now = new Date()
  try {
    if (dryRun) {
      const result = await Promise.race([runAgentTraceRetentionSweep({ db: prisma, now, dryRun: true }), timeout(SWEEP_TIMEOUT_MS)])
      return NextResponse.json({ dryRun: true, countsByClass: result.countsByClass, tenants: result.tenants })
    }
    const { start, end } = utcDayWindow(now)
    const already = await prisma.auditEvent.findFirst({
      where: { entityType: AGENT_TRACE_RETENTION_AUDIT_ENTITY, action: AGENT_TRACE_RETENTION_AUDIT_ACTION,
        occurredAt: { gte: start, lt: end } },
      orderBy: { occurredAt: 'desc' }, select: { id: true, payloadJson: true },
    })
    if (already) {
      const payload = JSON.parse(already.payloadJson)
      return NextResponse.json({ auditEventId: already.id, countsByClass: payload.countsByClass, alreadyRanToday: true })
    }
    const result = await Promise.race([runAgentTraceRetentionSweep({ db: prisma, now, dryRun }), timeout(SWEEP_TIMEOUT_MS)])
    return NextResponse.json({ auditEventId: result.auditEventId, countsByClass: result.countsByClass,
      alreadyRanToday: result.alreadyRanToday })
  } catch {
    return NextResponse.json({ error: 'RETENTION_SWEEP_UNAVAILABLE' }, { status: 503 })
  }
}
