'use client'

import { useParams } from 'next/navigation'
import ProjectDomainView from '@/modules/project-manager/components/ProjectDomainView'

// @req FR-251 — the read-only Execution Domains projection is available only
// beneath an authorized Project context at the existing PM route hierarchy.
// @spec ADR-096, SDD-019, docs/architecture/project-manager-system/23-PROJECT-DOMAIN-FEATURE-IMPLEMENTATION-BASELINE.md
// @tested tests/e2e/project-domain-view.spec.js
export default function ProjectDomainViewPage() {
  const { projectId } = useParams()
  return <ProjectDomainView key={projectId} projectId={projectId} />
}
