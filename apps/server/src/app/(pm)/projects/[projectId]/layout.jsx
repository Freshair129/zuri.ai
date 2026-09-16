'use client'

import { useParams, usePathname } from 'next/navigation'
import ProjectTabs from '@/modules/project-manager/components/ProjectTabs'
import { authorizedProjectFromScope, moduleForProjectPath } from '@/modules/project-manager/navigation'
import { useScope } from '@/context/ScopeContext'

// @req FR-247 — Project module selection uses complete route segments and the
// already authorized scope inventory; a URL parameter or persisted selection
// never grants access to a Project.
// @req FR-039, FR-043 — BusinessShellGuard remains the authorization boundary.
// @spec ADR-095, SDD-018
// @tested tests/unit/project-work-route.test.js, tests/unit/project-execution-backpath.test.js
export default function ProjectLayout({ children }) {
  const pathname = usePathname()
  const { projectId } = useParams()
  const scope = useScope()
  const authorizedProject = authorizedProjectFromScope(scope, projectId)
  const activeModule = moduleForProjectPath(pathname, projectId)

  return (
    <div>
      <ProjectTabs
        projectId={projectId}
        activeModule={activeModule}
        authorizedProject={authorizedProject}
      />
      {children}
    </div>
  )
}
