// @req FR-105 — operator-only, read-only Platform Programme Roadmap.
// @spec ADR-048 D1-D3, SDD-055, SEC-020
// @tested tests/unit/platform-control-route-contract.test.js

import ProgramRoadmapBoard from '@/modules/platform-control/components/ProgramRoadmapBoard'

export const metadata = { title: 'Platform Programme Roadmap — Zuri Control' }

export default function PlatformProgrammeRoadmapPage() {
  return <ProgramRoadmapBoard />
}
