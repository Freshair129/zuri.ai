'use client'

import { usePathname, useParams } from 'next/navigation'
import ProjectTabs from '@/modules/project-manager/components/ProjectTabs'

// @req FR-040 — Project-local navigation has one canonical tab bar.
// @spec SDD-019, ADR-012
// @tested tests/unit/project-work-route.test.js

export default function ProjectLayout({ children }) {
  const pathname = usePathname()
  const { projectId } = useParams()
  const base = `/projects/${projectId}`
  const active = pathname === base
    ? 'project'
    : pathname.includes('/team')
      ? 'team'
      : pathname.includes('/files')
        ? 'files'
        : ['/structure', '/board', '/timeline', '/dependencies', '/all-work', '/execution'].some((suffix) => pathname.includes(suffix))
          ? 'work'
          : undefined

  return (
    <div>
      <ProjectTabs projectId={projectId} active={active} />
      {children}
    </div>
  )
}
