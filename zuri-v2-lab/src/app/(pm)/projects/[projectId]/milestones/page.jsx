'use client'

import { useParams } from 'next/navigation'
import { PageHeader } from '@/components/ui'
import MilestonesView from '@/modules/project-manager/views/universal/MilestonesView'

export default function ProjectMilestonesPage() {
  const { projectId } = useParams()
  return (
    <div>
      <PageHeader eyebrow="Universal view" title="Milestones & Gates" subtitle="Weighted checkpoints and required gates for this project." />
      <MilestonesView projectId={projectId} />
    </div>
  )
}
