import {
  BriefcaseBusiness,
  LayoutDashboard,
  ListChecks,
  GanttChartSquare,
  Network,
  Flag,
  GitBranch,
  Rocket,
  FolderOpen,
} from 'lucide-react'

// @req FR-039 — Development owns project-management resources, not shell scope.
// @req FR-045 - the command palette exposes Business Files within Development.
// @spec SDD-018, ADR-011
// @tested tests/unit/domain-navigation.test.js, tests/unit/fr045-api-ui-contract.test.js
// NO LONGER FEEDS THE COMMAND PALETTE. `CommandPalette.jsx` now derives its
// route index from the `DOMAINS` registry in `./domains.js`, because building it
// from this list covered Development and nothing else — Business Home, Platform,
// HR / People and Profile were unsearchable. `nav` below is therefore a second
// hand-kept copy of Development's sub-domains that nothing reads at runtime:
// editing it changes no surface. `EXECUTION_NAV` is still live (the palette and
// `/execution` both read it).
//
// Kept only because `tests/unit/domain-navigation.test.js` pins its contents as
// the record of an ADR-008 §D6 decision (Space is not a Development capability).
// That decision is now also pinned against `DOMAINS` in
// `tests/unit/command-palette-index.test.js`; this object can be deleted once
// the older assertion is moved.
//
// Command-palette registry for the Development domain. HR / People is registered
// in the domain map but intentionally has its own peer route, not a Development
// sidebar entry.
export const modules = {
  projectManager: {
    key: 'projectManager',
    label: 'Development',
    icon: BriefcaseBusiness,
    // @req FR-060 — Development bases at its own resource list. `/overview`
    // became the Business Home Dashboard, a cross-domain surface, so it is
    // neither this module's base nor one of its nav entries.
    basePath: '/projects',
    nav: [
      // @req FR-086 — kept in step with `DOMAINS` in `./domains.js`, whose first
      // Development entry became `Dashboard` on 2026-08-19 (ADR-036 D1). Nothing
      // reads this list at runtime, but `domain-navigation.test.js` pins it, and
      // a stale copy of a nav list is exactly the thing that makes the next
      // reader trust the wrong one. `LayoutDashboard` mirrors the registry too:
      // `BriefcaseBusiness` stays the Development *domain* mark above.
      { label: 'Dashboard', path: '/projects', icon: LayoutDashboard },
      { label: 'All Work', path: '/work', icon: ListChecks },
      { label: 'Execution', path: '/execution', icon: Rocket },
      { label: 'Timeline', path: '/timeline', icon: GanttChartSquare },
      { label: 'Dependencies', path: '/dependencies', icon: Network },
      { label: 'Milestones & Gates', path: '/milestones', icon: Flag },
      { label: 'Files', path: '/files', icon: FolderOpen },
      { label: 'Repositories', path: '/repositories', icon: GitBranch },
    ],
  },
}

export const EXECUTION_NAV = [
  { label: 'Sprint', slug: 'sprint' },
  { label: 'Migration', slug: 'migration' },
  { label: 'B2B Sales', slug: 'b2b-sales' },
  { label: 'B2C Campaign', slug: 'b2c-campaign' },
  { label: 'Product Launch', slug: 'product-launch' },
  { label: 'Operations', slug: 'operations' },
  { label: 'Expansion', slug: 'expansion' },
]
