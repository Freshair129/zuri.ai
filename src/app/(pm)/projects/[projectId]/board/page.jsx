'use client'

import { useParams } from 'next/navigation'
import WorkViewTabs from '@/modules/project-manager/components/WorkViewTabs'
import KanbanBoard from '@/modules/project-manager/views/KanbanBoard'

export default function ProjectBoardPage() {
  const { projectId } = useParams()
  return (
    <div>
      <div className="mb-1">
        <h1 className="text-lg font-extrabold tracking-tight">Work Execution</h1>
        <p className="text-xs text-muted">Perform work, document results, and track progress transparently.</p>
      </div>
      <WorkViewTabs projectId={projectId} />
      <KanbanBoard projectId={projectId} />
    </div>
  )
}
