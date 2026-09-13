// @req FR-105 — operator-only, read-only Platform Programme Roadmap.
// @req FR-211 — the Domain map & inventory tab, projected here on the server so
// the client receives the trimmed projection, not the whole generated snapshot.
// @spec ADR-048 D1-D3, SDD-055, SEC-020, FR-124
// @tested tests/unit/platform-control-route-contract.test.js, tests/unit/platform-control-domain-map.test.js

import ProgramRoadmapBoard from '@/modules/platform-control/components/ProgramRoadmapBoard'
import { projectDomainMap } from '@/modules/platform-control/program-domain-map'
import { getProductReadinessSnapshot } from '@/modules/project-manager/application/product-readiness-read-model'

export const metadata = { title: 'Platform Programme Roadmap — Zuri Control' }

export default function PlatformProgrammeRoadmapPage({ searchParams }) {
  return (
    <ProgramRoadmapBoard
      domainMap={projectDomainMap(getProductReadinessSnapshot())}
      initialView={searchParams?.view === 'domains' ? 'domains' : 'programme'}
    />
  )
}
