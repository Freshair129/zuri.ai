// @req FR-105 — operator-only, read-only Platform Programme Roadmap.
// @req FR-211 — the Domain map & inventory tab, projected here on the server so
// the client receives the trimmed projection, not the whole generated snapshot.
// @req FR-216, FR-218 — phase delivery metrics: the meter's measured usage merged
// here with agent usage reports, a session counted once.
// @req FR-219 — task card evidence badges, computed here against the same snapshot.
// @req FR-221 — reports carry their person and device; the board breaks usage
// down by both, read through identity's reporter port (no key material).
// @spec ADR-048 D1-D3, ADR-086 D1, D5, D6, ADR-087 D4, SDD-055, SEC-020, FR-124
// @tested tests/unit/platform-control-route-contract.test.js, tests/unit/platform-control-domain-map.test.js, tests/unit/program-delivery-metrics.test.js

import prisma from '@/lib/db'
import ProgramRoadmapBoard from '@/modules/platform-control/components/ProgramRoadmapBoard'
import { projectDomainMap } from '@/modules/platform-control/program-domain-map'
import { PROGRAMME_CONTAINERS } from '@/modules/platform-control/program-roadmap-containers'
import { PROGRAMME_TASKS } from '@/modules/platform-control/program-roadmap-data'
import { PROGRAMME_LANES, PROGRAMME_SIZING, PROGRAMME_USAGE } from '@/modules/platform-control/program-roadmap-telemetry'
import { mergeLaneUsage } from '@/modules/platform-control/program-delivery-metrics'
import { projectTaskEvidence } from '@/modules/platform-control/program-task-evidence'
import { listProgrammeUsageReports } from '@/modules/platform-control/application/programme-usage-reports'
import { projectTaskUsageLedger, redactTaskUsageLedger } from '@/modules/platform-control/application/task-usage-ledger'
import { describeHarnessReporters } from '@/modules/identity/harness-credential'
import { getProductReadinessSnapshot } from '@/modules/project-manager/application/product-readiness-read-model'

export const metadata = { title: 'Platform Programme Roadmap — Zuri Control' }
export const dynamic = 'force-dynamic'

const VIEWS = new Set(['programme', 'domains', 'devices'])

export default async function PlatformProgrammeRoadmapPage({ searchParams }) {
  const snapshot = getProductReadinessSnapshot()
  const { available, reports } = await listProgrammeUsageReports(prisma)
  const reporters = await describeHarnessReporters({ installationIds: reports.map((r) => r.installationId), db: prisma })
  const laneUsage = mergeLaneUsage({ lanes: PROGRAMME_LANES, usage: PROGRAMME_USAGE, reports, reporters })
  const taskUsageLedger = projectTaskUsageLedger({
    knownTasks: PROGRAMME_TASKS,
    containers: PROGRAMME_CONTAINERS,
    lanes: PROGRAMME_LANES,
    meterUsage: PROGRAMME_USAGE,
    reports: { available, reports },
  })
  return (
    <ProgramRoadmapBoard
      domainMap={projectDomainMap(snapshot)}
      initialView={VIEWS.has(searchParams?.view) ? searchParams.view : 'programme'}
      laneUsage={Object.fromEntries(laneUsage)}
      usageReports={{ available, count: reports.length }}
      taskUsageLedger={redactTaskUsageLedger(taskUsageLedger, 'operator')}
      taskEvidence={projectTaskEvidence({ tasks: PROGRAMME_TASKS, containers: PROGRAMME_CONTAINERS, snapshot })}
      lanes={PROGRAMME_LANES}
      sizing={PROGRAMME_SIZING}
      measuredThrough={PROGRAMME_USAGE.measuredThrough}
    />
  )
}
