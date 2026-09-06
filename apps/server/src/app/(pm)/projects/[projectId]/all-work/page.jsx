'use client'

// @req FR-005 — this project-scoped instance of the neutral WorkContainer/
// WorkItem "All Work" browser: every tracked WorkItem in one Project, across
// all execution modes, status-editable. Same view and service as the global
// instance, filtered here to a Project.
// @req FR-040 — All Work is a Project Work sub-view, so it mounts the same
// `WorkViewTabs` bar as its siblings. Before it did, the project layout already
// claimed this route for the Work tab while the page rendered no way back to
// Structure Plan, Board or the Roadmap — a one-way door.
// @spec SDD-019, ADR-012
// @tested tests/unit/project-work-route.test.js, tests/unit/route-reachability.test.js
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/ui'
import WorkViewTabs from '@/modules/project-manager/components/WorkViewTabs'
import AllWorkView from '@/modules/project-manager/views/universal/AllWorkView'

export default function ProjectAllWorkPage() {
  const { projectId } = useParams()
  return (
    <div>
      <PageHeader
        eyebrow="Project Work"
        title="All Work"
        subtitle="Every tracked work item in this project, across all execution modes."
        actions={<Link className="btn" href="/work" aria-label="View all work across all projects">All projects</Link>}
      />
      <WorkViewTabs projectId={projectId} />
      <AllWorkView projectId={projectId} />
    </div>
  )
}
