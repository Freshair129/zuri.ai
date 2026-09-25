import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { PROGRAMME_TASKS } from '@/modules/platform-control/program-roadmap-data'
import { bearerMatches, recordProgrammeUsageReport } from '@/modules/platform-control/application/programme-usage-reports'

// @req FR-218 — an automation job reports usage with the deployment bearer,
//   checked before the body is read. Historical harness-attributed rows remain read-only.
// @spec ADR-086 D5; SEC-001; ADR-109 D1, D3
// @tested tests/unit/programme-usage-reports.test.js

export const dynamic = 'force-dynamic'

const KNOWN_TASK_CODES = new Set(PROGRAMME_TASKS.map(([id]) => id))

export async function POST(request) {
  try {
    if (!bearerMatches(request.headers.get('authorization'), process.env.ZURI_PROGRAMME_USAGE_TOKEN)) {
      return NextResponse.json({ error: 'USAGE_REPORT_CREDENTIAL_REQUIRED' }, { status: 401 })
    }
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'USAGE_REPORT_INVALID', issues: [{ path: '', message: 'body must be a JSON object' }] }, { status: 400 })
    }
    const { status, body: result } = await recordProgrammeUsageReport(prisma, body, { knownTaskCodes: KNOWN_TASK_CODES })
    return NextResponse.json(result, { status })
  } catch {
    return NextResponse.json({ error: 'USAGE_REPORT_UNAVAILABLE' }, { status: 503 })
  }
}
