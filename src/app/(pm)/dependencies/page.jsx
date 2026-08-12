'use client'

import { PageHeader } from '@/components/ui'
import DependenciesView from '@/modules/project-manager/views/universal/DependenciesView'

export default function GlobalDependenciesPage() {
  return (
    <div>
      <PageHeader eyebrow="Universal view" title="Dependencies" subtitle="Blocking and ordering relations across all tracked entities." />
      <DependenciesView />
    </div>
  )
}
