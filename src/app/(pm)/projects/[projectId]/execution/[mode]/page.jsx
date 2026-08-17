'use client'

// @req FR-009 — renders one of the seven execution mode views, scoped to
// this Project (the project-scoped instance over the same neutral core
// model as the global route).
import { useParams } from 'next/navigation'
import { MODE_SLUGS } from '@/lib/validation/enums'
import { EmptyState } from '@/components/ui'
import ExecutionModeView from '@/modules/project-manager/views/execution/ExecutionModeView'

export default function ProjectExecutionModePage() {
  const { projectId, mode } = useParams()
  const executionMode = MODE_SLUGS[mode]
  if (!executionMode) {
    return <EmptyState title="Unknown execution mode" hint={`"${mode}" is not one of the seven canonical modes.`} />
  }
  return <ExecutionModeView mode={executionMode} projectId={projectId} />
}
