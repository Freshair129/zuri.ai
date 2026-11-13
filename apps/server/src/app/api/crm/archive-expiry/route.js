import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { runChatEvidenceArchiveExpiry } from '@/modules/crm/chat-evidence-archive-expiry-run-service'
import { assertArchiveStorageReady, resolveArchiveBaseDir } from '@/modules/crm/chat-evidence-archive-service'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { bearerMatches } from '@/modules/platform-control/application/programme-usage-reports'

// @req FR-245, SEC-034 — scheduled, Tenant-scoped archive expiry and chain
//   retirement. The deployment bearer is checked before database or archive
//   work, and the route returns only aggregate counts (ADR-093 D5, P7).
// @spec ADR-093 D5 (1.3.0), SDD-103, SEC-001
// @tested tests/unit/crm-archive-expiry-route.test.js
export const dynamic = 'force-dynamic'

function utcDayWindow(now) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) }
}

async function findCompletedRun(start, end) {
  return prisma.auditEvent.findFirst({
    where: {
      entityType: 'ARCHIVE_EXPIRY_RUN',
      action: 'ARCHIVE_EXPIRY_RUN_COMPLETED',
      occurredAt: { gte: start, lt: end },
    },
    orderBy: { occurredAt: 'desc' },
    select: { payloadJson: true },
  })
}

function completedResponse(event) {
  const payload = JSON.parse(event.payloadJson)
  return NextResponse.json({ counts: payload.counts, alreadyRanToday: true })
}

export async function POST(request) {
  if (!bearerMatches(request.headers.get('authorization'), process.env.ZURI_RETENTION_SWEEP_TOKEN)) {
    return NextResponse.json({ error: 'RETENTION_SWEEP_CREDENTIAL_REQUIRED' }, { status: 401 })
  }

  const env = process.env
  const now = new Date()
  const { start, end } = utcDayWindow(now)
  const day = start.toISOString().slice(0, 10)
  const claimId = `archive-expiry-claim:${day}`

  try {
    let archiveBaseDir
    if (env.NODE_ENV === 'production') {
      archiveBaseDir = resolveArchiveBaseDir(env)
      await assertArchiveStorageReady(archiveBaseDir, env)
    }

    const completed = await findCompletedRun(start, end)
    if (completed) return completedResponse(completed)

    try {
      await recordAudit(prisma, {
        id: claimId,
        entityType: 'ARCHIVE_EXPIRY_RUN',
        entityId: claimId,
        action: 'ARCHIVE_EXPIRY_RUN_CLAIMED',
        actorType: 'SYSTEM',
        payload: { claimedAt: now.toISOString() },
      })
    } catch (error) {
      if (error?.code !== 'P2002') throw error
      const completedAfterClaimRace = await findCompletedRun(start, end)
      if (completedAfterClaimRace) return completedResponse(completedAfterClaimRace)
      return NextResponse.json({ error: 'ARCHIVE_EXPIRY_RUN_IN_PROGRESS' }, { status: 409 })
    }

    // A crash after this daily claim but before the completion audit leaves the
    // claim in place. Same-day calls get 409; a new UTC day has a new claim id.
    // This route awaits the run; the service stops starting Tenants at its
    // deadline and records the deferred count instead of returning early.
    const result = await runChatEvidenceArchiveExpiry(prisma, {
      now,
      ...(archiveBaseDir ? { baseDir: archiveBaseDir, storagePrechecked: true } : {}),
      env,
    })
    return NextResponse.json({ counts: result.counts, alreadyRanToday: false })
  } catch {
    return NextResponse.json({ error: 'ARCHIVE_EXPIRY_UNAVAILABLE' }, { status: 503 })
  }
}
