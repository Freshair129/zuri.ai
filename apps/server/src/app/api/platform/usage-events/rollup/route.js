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

export async function POST(request) {
  if (!bearerMatches(request.headers.get('authorization'), process.env.ZURI_USAGE_ROLLUP_TOKEN)) {
    return NextResponse.json({ error: 'USAGE_ROLLUP_CREDENTIAL_REQUIRED' }, { status: 401 })
  }
  const now = new Date()
  try {
    // The once-per-day predicate lives inside rollupUsageEvents' Serializable
    // transaction. Keeping it there makes the audit claim and the raw-row
    // replacement one database decision under concurrent scheduler retries.
    const result = await rollupUsageEvents(prisma, { now, oncePerDay: true })
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'USAGE_ROLLUP_UNAVAILABLE' }, { status: 503 })
  }
}
