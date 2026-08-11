'use client'

import { useParams } from 'next/navigation'
import { PageHeader } from '@/components/ui'
import DependenciesView from '@/modules/project-manager/views/universal/DependenciesView'

export default function ProjectDependenciesPage() {
  const { projectId } = useParams()
  return (
    <div>
      <PageHeader eyebrow="Universal view" title="Dependencies" subtitle="Blocking and ordering relations touching this project." />
      <DependenciesView projectId={projectId} />
    </div>
  )
}
