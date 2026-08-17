'use client'

// @req FR-005 — the cross-project All Work browser over the neutral
// WorkContainer/WorkItem model: filterable, status-editable, global scope.
// @tested tests/e2e/smoke.spec.js
import { PageHeader } from '@/components/ui'
import AllWorkView from '@/modules/project-manager/views/universal/AllWorkView'

export default function GlobalWorkPage() {
  return (
    <div>
      <PageHeader eyebrow="Universal view" title="All Work" subtitle="Every tracked work item across projects and execution modes." />
      <AllWorkView />
    </div>
  )
}
