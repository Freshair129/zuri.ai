'use client'

// @req FR-006 — the cross-project Milestones & Gates browser: weighted
// milestones and their required-flag gates, status-editable, across all
// projects.
// @tested tests/e2e/smoke.spec.js
import { PageHeader } from '@/components/ui'
import MilestonesView from '@/modules/project-manager/views/universal/MilestonesView'

export default function GlobalMilestonesPage() {
  return (
    <div>
      <PageHeader eyebrow="Business scope" title="Milestones & Gates" subtitle="Checkpoints and gates across the selected Business." />
      <MilestonesView />
    </div>
  )
}
