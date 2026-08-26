// @req FR-094 — public, aggregate-only programme status share.
// @spec ADR-039 D5, SDD-052 — no viewer, source-data read or mutation is mounted.
// @tested tests/unit/platform-control-route-contract.test.js

import PlatformControlShell from '@/components/layouts/PlatformControlShell'
import ProgramRoadmapBoard from '@/modules/platform-control/components/ProgramRoadmapBoard'

export const metadata = {
  title: 'Zuri AI Programme Status',
  description: 'Public, read-only aggregate programme status snapshot.',
  robots: { index: false, follow: false },
}

export default function PublicProgrammePage() {
  return (
    <PlatformControlShell publicShare>
      <ProgramRoadmapBoard publicShare />
    </PlatformControlShell>
  )
}
