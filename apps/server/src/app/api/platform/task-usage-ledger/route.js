import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { PROGRAMME_TASKS } from '@/modules/platform-control/program-roadmap-data'
import { PROGRAMME_CONTAINERS } from '@/modules/platform-control/program-roadmap-containers'
import { PROGRAMME_LANES, PROGRAMME_USAGE } from '@/modules/platform-control/program-roadmap-telemetry'
import { bearerMatches, listProgrammeUsageReports } from '@/modules/platform-control/application/programme-usage-reports'
import { projectTaskUsageLedger, redactTaskUsageLedger } from '@/modules/platform-control/application/task-usage-ledger'

// @req FR-216, FR-218 — the deployment-authenticated read projection exposes
// task-bound measured aggregates only; bearer validation runs before URL/body
// access and lane-only rows are never divided across their tasks.
// @spec ADR-086 D1-D7; ADR-087 D4-D6; task-usage-ledger.v1 contract
// @tested tests/unit/task-usage-ledger-export.test.js

export const dynamic = 'force-dynamic'

const KNOWN_TASK_CODES = new Set(PROGRAMME_TASKS.map(([id]) => id))

const json = (body, status = 200) => NextResponse.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' },
})

export async function GET(request) {
  // This must remain the first request operation. In particular, do not parse
  // URL parameters or a body before the deployment bearer is established.
  if (!bearerMatches(request.headers.get('authorization'), process.env.ZURI_PROGRAMME_USAGE_TOKEN)) {
    return json({ error: 'TASK_USAGE_LEDGER_CREDENTIAL_REQUIRED' }, 401)
  }

  try {
    const taskCode = new URL(request.url).searchParams.get('taskCode') || null
    if (taskCode && !KNOWN_TASK_CODES.has(taskCode)) {
      return json({ error: 'PROGRAMME_TASK_UNKNOWN', taskCode }, 404)
    }

    const source = await listProgrammeUsageReports(prisma)
    const ledger = projectTaskUsageLedger({
      knownTasks: PROGRAMME_TASKS,
      containers: PROGRAMME_CONTAINERS,
      lanes: PROGRAMME_LANES,
      meterUsage: PROGRAMME_USAGE,
      reports: source,
    })
    const safeLedger = redactTaskUsageLedger(ledger)
    if (taskCode) safeLedger.tasks = safeLedger.tasks.filter((task) => task.taskCode === taskCode)
    return json(safeLedger)
  } catch {
    return json({ error: 'TASK_USAGE_LEDGER_UNAVAILABLE' }, 503)
  }
}
