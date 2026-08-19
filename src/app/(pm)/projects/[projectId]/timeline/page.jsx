'use client'

// @req FR-064 — Schedule: this Project's own `startAt`/`targetAt` window and
// its Milestones' `targetAt` dates rendered on one derived month-grid
// timeline (the project-scoped half; the global route covers all projects
// on the same view). Read-only — no date is editable here, nothing is
// persisted, and an undated Project or Milestone renders no bar.
// @spec SDD-036
// @req FR-040 — Schedule is the `WorkViewTabs` "Schedule" destination, so it
// mounts that bar like its sibling Work sub-views. It did not, which made the
// tab a one-way door: arriving here removed every route back to Structure
// Plan, Board, Roadmap and Dependency Map.
// @spec SDD-019, ADR-012
// @tested tests/unit/project-work-route.test.js
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/ui'
import WorkViewTabs from '@/modules/project-manager/components/WorkViewTabs'
import TimelineView from '@/modules/project-manager/views/universal/TimelineView'

export default function ProjectTimelinePage() {
  const { projectId } = useParams()
  return (
    <div>
      <PageHeader
        eyebrow="Project Work"
        title="Schedule"
        subtitle="Project window and milestone targets."
        actions={<Link className="btn" href="/timeline" aria-label="View the schedule across all projects">All projects</Link>}
      />
      <WorkViewTabs projectId={projectId} />
      <TimelineView projectId={projectId} />
    </div>
  )
}
