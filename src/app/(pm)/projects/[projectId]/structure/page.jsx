'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useFetch, LoadingCard } from '@/modules/project-manager/components/useApi'
import ProjectTabs from '@/modules/project-manager/components/ProjectTabs'
import WorkViewTabs from '@/modules/project-manager/components/WorkViewTabs'
import WbsCanvas from '@/modules/project-manager/views/WbsCanvas'
import { ErrorState } from '@/components/ui'

export default function ProjectStructurePage() {
  const { projectId } = useParams()
  const project = useFetch(`/api/projects/${projectId}`)

  return (
    <div>
      <ProjectTabs projectId={projectId} active="work" />

      <div className="mb-4 flex items-start gap-3">
        <Link
          href={`/projects/${projectId}`}
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--muted)] hover:text-[var(--text)]"
          aria-label="Back to project"
        >
          <ArrowLeft size={15} />
        </Link>
        <div>
          <h1 className="text-lg font-extrabold tracking-tight">Project Structure Plan</h1>
          <p className="text-xs text-muted">Plan the project structure and define part projects, part tasks and work packages.</p>
        </div>
      </div>

      <WorkViewTabs projectId={projectId} />

      {project.loading ? (
        <LoadingCard />
      ) : project.error ? (
        <ErrorState detail={project.error} retry={project.reload} />
      ) : (
        <WbsCanvas projectId={projectId} />
      )}
    </div>
  )
}
