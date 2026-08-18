'use client'

// @req FR-006 — this project-scoped instance of the Milestones & Gates
// browser: weighted milestones and their required-flag gates, status-
// editable, filtered to one Project (same view and service as the global
// instance).
// @req FR-040 — it is a Project Work sub-view, so it mounts the same
// `WorkViewTabs` bar as Structure Plan, Board and Dependency Map. Without the
// bar this route was both unreachable (no tab pointed here) and a dead end
// (nothing pointed back).
// @spec SDD-019, ADR-012
// @tested tests/unit/project-work-route.test.js
import { useParams } from 'next/navigation'
import { PageHeader } from '@/components/ui'
import WorkViewTabs from '@/modules/project-manager/components/WorkViewTabs'
import MilestonesView from '@/modules/project-manager/views/universal/MilestonesView'

export default function ProjectMilestonesPage() {
  const { projectId } = useParams()
  return (
    <div>
      <PageHeader eyebrow="Project Work" title="Milestones & Gates" subtitle="Weighted checkpoints and required gates for this project." />
      <WorkViewTabs projectId={projectId} />
      <MilestonesView projectId={projectId} />
    </div>
  )
}
