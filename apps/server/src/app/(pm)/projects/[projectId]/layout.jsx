'use client'

import { usePathname, useParams } from 'next/navigation'
import ProjectTabs from '@/modules/project-manager/components/ProjectTabs'

// @req FR-040 — Project-local navigation has one canonical tab bar.
// @req FR-006, FR-012 — `/milestones` now resolves to the Work tab (it became a
// `WorkViewTabs` sub-view) and `/import` owns its own tab. Both routes
// previously fell through every branch to `active: undefined`, so even a user
// who reached them by URL saw no tab marked current.
// @req FR-009 — `/execution/{mode}` resolves to the Project tab, because that
// is the tab whose page opens it; a highlight that names the wrong section is
// a wrong answer, not a cosmetic one.
// @req FR-008 — `/repositories` resolves to Inventory by that same rule. It had
// no row, so a user who followed Inventory's "Open repositories →" link landed
// on a Project page with no tab marked current at all.
// @spec SDD-019, ADR-012
// @tested tests/unit/project-work-route.test.js, tests/unit/project-execution-backpath.test.js

// Ordered because the first match wins and the suffixes are not disjoint:
// a Work sub-view must not be claimed by a broader entry above it. Table form
// rather than a six-deep ternary so adding a route is one row, and so a route
// that matches nothing is visibly absent instead of silently `undefined`.
//
// `/execution` maps to `project`, not `work`. Two facts decide it. The only
// inbound link to `/projects/{id}/execution/{mode}` is the "Open view" button
// on a Workstream card on the Project detail page — the `project` tab's own
// page. And the mode view is not one of the seven `WorkViewTabs` sub-views
// (Execution Roadmap, Structure Plan, Board, All Work, Schedule, Milestones &
// Gates, Dependency Map), so lighting up Work pointed at a sub-view bar that
// does not contain the current page, and offered a tab that navigates to
// `/structure` — somewhere the user had never been. It sits first in the table
// because `work` carries the broad suffix list: first position is what stops a
// later edit there from silently reclaiming this route.
//
// The rule that settles both `/execution` and `/repositories` is the same one:
// a sub-route belongs to the tab whose page opens it. `/repositories` has no
// tab of its own and is reached from the Inventory page's "Open repositories →"
// link, so Inventory is where the user branched from and Inventory is what the
// highlight should name. It had no row at all, which is the same
// `active: undefined` hole `/milestones` and `/import` were added to close.
const TAB_SUFFIXES = [
  ['project', ['/execution']],
  ['inventory', ['/inventory', '/repositories']],
  ['team', ['/team']],
  ['files', ['/files']],
  ['import', ['/import']],
  ['work', ['/roadmap', '/structure', '/board', '/timeline', '/milestones', '/dependencies', '/all-work']],
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
