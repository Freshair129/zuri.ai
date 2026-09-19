// @req FR-241 — the programme roadmap member view: any signed-in person reads the
//   plan and the Domain map until the window closes; people, devices, tool and
//   model names are removed here, on the server, before anything renders.
// @spec ADR-092 D1–D4, ADR-048 D3, SEC-020
// @tested tests/unit/programme-member-view.test.js

import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import prisma from '@/lib/db'
import { SESSION_UNAVAILABLE_DETAIL_TH, SESSION_UNAVAILABLE_TITLE_TH } from '@/lib/viewer-failure'
import PlatformControlSessionRetry from '@/components/layouts/PlatformControlSessionRetry'
import PlatformControlShell from '@/components/layouts/PlatformControlShell'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import ProgramRoadmapBoard from '@/modules/platform-control/components/ProgramRoadmapBoard'
import { projectDomainMap } from '@/modules/platform-control/program-domain-map'
import { PROGRAMME_CONTAINERS } from '@/modules/platform-control/program-roadmap-containers'
import { PROGRAMME_TASKS } from '@/modules/platform-control/program-roadmap-data'
import { PROGRAMME_LANES, PROGRAMME_SIZING, PROGRAMME_USAGE } from '@/modules/platform-control/program-roadmap-telemetry'
import { mergeLaneUsage } from '@/modules/platform-control/program-delivery-metrics'
import { projectTaskEvidence } from '@/modules/platform-control/program-task-evidence'
import { listProgrammeUsageReports } from '@/modules/platform-control/application/programme-usage-reports'
import { projectTaskUsageLedger, redactTaskUsageLedger } from '@/modules/platform-control/application/task-usage-ledger'
import {
  MEMBER_VIEW_CLOSES_AT,
  projectMemberLaneUsage,
  resolveMemberRoadmapDecision,
} from '@/modules/platform-control/programme-member-view'
import { getProductReadinessSnapshot } from '@/modules/project-manager/application/product-readiness-read-model'

export const metadata = { title: 'Programme Roadmap — Zuri', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

const VIEWS = new Set(['programme', 'domains'])

function serverRequest() {
  const cookieHeader = cookies().getAll().map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; ')
  return new Request('https://zuri.local/roadmap', { headers: { cookie: cookieHeader } })
}

export default async function ProgrammeRoadmapMemberPage({ searchParams }) {
  let viewer = null
  let viewerError = null
  try {
    viewer = await resolveRequestViewer(serverRequest())
  } catch (error) {
    viewerError = error
  }
  const decision = resolveMemberRoadmapDecision({ viewer, viewerError })
  if (decision.state === 'CLOSED') notFound()
  if (decision.state === 'AUTH_REQUIRED') redirect('/login')
  if (decision.state === 'SESSION_UNAVAILABLE') {
    return <PlatformControlSessionRetry title={SESSION_UNAVAILABLE_TITLE_TH} detail={SESSION_UNAVAILABLE_DETAIL_TH} />
  }

  const snapshot = getProductReadinessSnapshot()
  // Reporters (person and device names) are deliberately not resolved: the member
  // projection drops every breakdown they would feed (ADR-092 D3).
  const { available, reports } = await listProgrammeUsageReports(prisma)
  const laneUsage = projectMemberLaneUsage(mergeLaneUsage({ lanes: PROGRAMME_LANES, usage: PROGRAMME_USAGE, reports, reporters: {} }))
  const taskUsageLedger = projectTaskUsageLedger({
    knownTasks: PROGRAMME_TASKS,
    containers: PROGRAMME_CONTAINERS,
    lanes: PROGRAMME_LANES,
    meterUsage: PROGRAMME_USAGE,
    reports: { available, reports },
  })
  return (
    <PlatformControlShell title="Programme Roadmap" footer="Programme roadmap · signed-in read-only preview (ADR-092)">
      <ProgramRoadmapBoard
        audience="member"
        closesAt={MEMBER_VIEW_CLOSES_AT}
        domainMap={projectDomainMap(snapshot)}
        initialView={VIEWS.has(searchParams?.view) ? searchParams.view : 'programme'}
        laneUsage={laneUsage}
        usageReports={{ available, count: reports.length }}
        taskUsageLedger={redactTaskUsageLedger(taskUsageLedger)}
        taskEvidence={projectTaskEvidence({ tasks: PROGRAMME_TASKS, containers: PROGRAMME_CONTAINERS, snapshot })}
        lanes={PROGRAMME_LANES}
        sizing={PROGRAMME_SIZING}
        measuredThrough={PROGRAMME_USAGE.measuredThrough}
      />
    </PlatformControlShell>
  )
}
