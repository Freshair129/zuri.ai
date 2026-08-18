'use client'

import { usePathname, useParams } from 'next/navigation'
import ProjectTabs from '@/modules/project-manager/components/ProjectTabs'

// @req FR-040 — Project-local navigation has one canonical tab bar.
// @req FR-006, FR-012 — `/milestones` now resolves to the Work tab (it became a
// `WorkViewTabs` sub-view) and `/import` owns its own tab. Both routes
// previously fell through every branch to `active: undefined`, so even a user
// who reached them by URL saw no tab marked current.
// @spec SDD-019, ADR-012
// @tested tests/unit/project-work-route.test.js

// Ordered because the first match wins and the suffixes are not disjoint:
// a Work sub-view must not be claimed by a broader entry above it. Table form
// rather than a six-deep ternary so adding a route is one row, and so a route
// that matches nothing is visibly absent instead of silently `undefined`.
const TAB_SUFFIXES = [
  ['inventory', ['/inventory']],
  ['team', ['/team']],
  ['files', ['/files']],
  ['import', ['/import']],
  ['work', ['/roadmap', '/structure', '/board', '/timeline', '/milestones', '/dependencies', '/all-work', '/execution']],
]

// Deliberately not exported: Next.js reserves the export surface of a `layout`
// file, so this stays module-local.
function activeProjectTab(pathname, base) {
  if (pathname === base) return 'project'
  const hit = TAB_SUFFIXES.find(([, suffixes]) => suffixes.some((suffix) => pathname.includes(suffix)))
  return hit ? hit[0] : undefined
}

export default function ProjectLayout({ children }) {
  const pathname = usePathname()
  const { projectId } = useParams()
  const active = activeProjectTab(pathname, `/projects/${projectId}`)

  return (
    <div>
      <ProjectTabs projectId={projectId} active={active} />
      {children}
    </div>
  )
}
