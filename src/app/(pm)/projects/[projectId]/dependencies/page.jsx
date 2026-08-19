'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ErrorState, PageHeader } from '@/components/ui'
import { LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'
import WorkViewTabs from '@/modules/project-manager/components/WorkViewTabs'
import DependencyMap from '@/modules/project-manager/views/DependencyMap'

// @req FR-040 — the project-contained Dependency Map lives under Project > Work.
// @spec SDD-019, ADR-012 — W1 owns the graph DTO; W4 replaces this boundary with
// the visual graph and accessible list fallback.
// @tested tests/unit/project-work-route.test.js

export default function ProjectDependenciesPage() {
  const { projectId } = useParams()
  const dependencyMap = useFetch(projectId ? `/api/projects/${projectId}/dependencies` : null)

  return (
    <div>
      <PageHeader
        eyebrow="Project Work"
        title="Dependency Map"
        subtitle="See the dependency edges whose endpoints belong to this project."
        actions={<Link className="btn" href="/dependencies" aria-label="Open the dependency register across all projects">All projects</Link>}
      />
      <WorkViewTabs projectId={projectId} />

      {dependencyMap.loading && <LoadingCard />}
      {dependencyMap.error && <ErrorState detail={dependencyMap.error} retry={dependencyMap.reload} />}
      {!dependencyMap.loading && !dependencyMap.error && <DependencyMap graph={dependencyMap.data} />}
    </div>
  )
}
