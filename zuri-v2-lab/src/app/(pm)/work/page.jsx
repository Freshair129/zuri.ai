'use client'

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
