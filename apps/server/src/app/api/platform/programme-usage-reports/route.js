import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { PROGRAMME_TASKS } from '@/modules/platform-control/program-roadmap-data'
import { bearerMatches, recordProgrammeUsageReport } from '@/modules/platform-control/application/programme-usage-reports'

// @req FR-218 — an agent without local session logs reports one session's usage
//   for one programme task. Deployment-authenticated like the LINE worker: the
//   bearer is checked before the body is read, and a wrong or missing bearer
//   answers 401 whatever the body says.
// @spec ADR-086 D5, SEC-001
// @tested tests/unit/programme-usage-reports.test.js

export const dynamic = 'force-dynamic'

const KNOWN_TASK_CODES = new Set(PROGRAMME_TASKS.map(([id]) => id))

export async function POST(request) {
  if (!bearerMatches(request.headers.get('authorization'), process.env.ZURI_PROGRAMME_USAGE_TOKEN)) {
    return NextResponse.json({ error: 'USAGE_REPORT_CREDENTIAL_REQUIRED' }, { status: 401 })
  }
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'USAGE_REPORT_INVALID', issues: [{ path: '', message: 'body must be a JSON object' }] }, { status: 400 })
  }
  try {
    const { status, body: result } = await recordProgrammeUsageReport(prisma, body, { knownTaskCodes: KNOWN_TASK_CODES })
    return NextResponse.json(result, { status })
  } catch {
    return NextResponse.json({ error: 'USAGE_REPORT_UNAVAILABLE' }, { status: 503 })
  }
}
