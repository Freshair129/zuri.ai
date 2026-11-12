import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { runChatEvidenceArchiveExpiry } from '@/modules/crm/chat-evidence-archive-expiry-run-service'
import { bearerMatches } from '@/modules/platform-control/application/programme-usage-reports'

// @req FR-245, SEC-034 — scheduled, Tenant-scoped archive expiry and chain
//   retirement. The deployment bearer is checked before database or archive
//   work, and the route returns only aggregate counts (ADR-093 D5, P7).
// @spec ADR-093 D5 (1.3.0), SDD-103, SEC-001
// @tested tests/unit/crm-archive-expiry-route.test.js
export const dynamic = 'force-dynamic'

const ARCHIVE_EXPIRY_TIMEOUT_MS = 10 * 60 * 1000

function utcDayWindow(now) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) }
}

function timeout(ms) {
  let timer
  const promise = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('ARCHIVE_EXPIRY_TIMEOUT')), ms)
  })
  return { promise, clear: () => clearTimeout(timer) }
}

export async function POST(request) {
  if (!bearerMatches(request.headers.get('authorization'), process.env.ZURI_RETENTION_SWEEP_TOKEN)) {
    return NextResponse.json({ error: 'RETENTION_SWEEP_CREDENTIAL_REQUIRED' }, { status: 401 })
  }

  const now = new Date()
  try {
    const { start, end } = utcDayWindow(now)
    const already = await prisma.auditEvent.findFirst({
      where: {
        entityType: 'ARCHIVE_EXPIRY_RUN',
        action: 'ARCHIVE_EXPIRY_RUN_COMPLETED',
        occurredAt: { gte: start, lt: end },
      },
      orderBy: { occurredAt: 'desc' },
      select: { payloadJson: true },
    })
    if (already) {
      const payload = JSON.parse(already.payloadJson)
      return NextResponse.json({ counts: payload.counts, alreadyRanToday: true })
    }

    const deadline = timeout(ARCHIVE_EXPIRY_TIMEOUT_MS)
    let result
    try {
      result = await Promise.race([runChatEvidenceArchiveExpiry(prisma, { now }), deadline.promise])
    } finally {
      deadline.clear()
    }
    return NextResponse.json({ counts: result.counts, alreadyRanToday: false })
  } catch {
    return NextResponse.json({ error: 'ARCHIVE_EXPIRY_UNAVAILABLE' }, { status: 503 })
  }
}
