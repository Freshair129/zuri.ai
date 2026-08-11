'use client'

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
