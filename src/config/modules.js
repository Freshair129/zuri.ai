import {
  BriefcaseBusiness,
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
// Command-palette registry for the Development domain. HR / People is registered
// in the domain map but intentionally has its own peer route, not a Development
// sidebar entry.
export const modules = {
  projectManager: {
    key: 'projectManager',
    label: 'Development',
    icon: BriefcaseBusiness,
    // The Business Overview is the shell root; it is not a Development
    // command-palette or sidebar entry.
    basePath: '/overview',
    nav: [
      { label: 'Projects', path: '/projects', icon: BriefcaseBusiness },
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
