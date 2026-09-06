'use client'

// @req FR-063 — Project Board: this Project's WorkItems rendered as a status
// board, one column per value of `WORK_STATUSES` (derived from
// src/lib/validation/enums.js, never a hand-written list). A card opens the
// existing Workpackage editor; the board itself persists no column, order,
// or card position.
// @spec SDD-036, SDD-019
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
