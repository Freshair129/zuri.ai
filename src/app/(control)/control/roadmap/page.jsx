// @req FR-094 — operator-only, read-only Platform Programme Roadmap.
// @spec ADR-039 D1-D3, SDD-052, SEC-018
// @tested tests/unit/platform-control-route-contract.test.js

import ProgramRoadmapBoard from '@/modules/platform-control/components/ProgramRoadmapBoard'

export const metadata = { title: 'Platform Programme Roadmap — Zuri Control' }

export default function PlatformProgrammeRoadmapPage() {
  return <ProgramRoadmapBoard />
}
