'use client'

// @req FR-064 — Schedule: this Project's own `startAt`/`targetAt` window and
// its Milestones' `targetAt` dates rendered on one derived month-grid
// timeline (the project-scoped half; the global route covers all projects
// on the same view). Read-only — no date is editable here, nothing is
// persisted, and an undated Project or Milestone renders no bar.
// @spec SDD-036
import { useParams } from 'next/navigation'
import { PageHeader } from '@/components/ui'
import TimelineView from '@/modules/project-manager/views/universal/TimelineView'

export default function ProjectTimelinePage() {
  const { projectId } = useParams()
  return (
    <div>
      <PageHeader eyebrow="Universal view" title="Timeline" subtitle="Project window and milestone targets." />
      <TimelineView projectId={projectId} />
    </div>
  )
}
