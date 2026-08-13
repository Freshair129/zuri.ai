'use client'

// @req FR-037, FR-045 - Project Files compatibility surface over managed FileAsset.
// @spec SDD-016, SDD-023, SEC-007
// @tested tests/unit/project-file-service.test.js, tests/unit/fr045-api-ui-contract.test.js
import { useParams } from 'next/navigation'
import { PageHeader, ErrorState } from '@/components/ui'
import { LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'
import ManagedFilesPanel from '@/modules/project-manager/components/ManagedFilesPanel'

export default function ProjectFilesPage() {
  const { projectId } = useParams()
  const project = useFetch(`/api/projects/${projectId}`)
  if (project.loading) return <LoadingCard />
  if (project.error) return <ErrorState detail={project.error} retry={project.reload} />
  return <div>
    <PageHeader eyebrow={project.data?.code || 'Project'} title="Files" subtitle="Managed Project files with local, external and portable metadata storage modes." />
    <ManagedFilesPanel businessId={project.data.businessId} projectId={projectId} />
  </div>
}
