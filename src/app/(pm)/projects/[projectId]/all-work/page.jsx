'use client'

// @req FR-005 — this project-scoped instance of the neutral WorkContainer/
// WorkItem "All Work" browser: every tracked WorkItem in one Project, across
// all execution modes, status-editable. Same view and service as the global
// instance, filtered here to a Project.
import { useParams } from 'next/navigation'
import { PageHeader } from '@/components/ui'
import AllWorkView from '@/modules/project-manager/views/universal/AllWorkView'

export default function ProjectAllWorkPage() {
  const { projectId } = useParams()
  return (
    <div>
      <PageHeader eyebrow="Universal view" title="All Work" subtitle="Every tracked work item in this project, across all execution modes." />
      <AllWorkView projectId={projectId} />
    </div>
  )
}
