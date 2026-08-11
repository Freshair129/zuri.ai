import {
  LayoutDashboard,
  Layers3,
  BriefcaseBusiness,
  ListChecks,
  GanttChartSquare,
  Network,
  Flag,
  GitBranch,
  Rocket,
  ScrollText,
  DatabaseBackup,
  Settings,
} from 'lucide-react'

// Module registry — mirrors current Zuri's src/config/modules.js pattern.
// Project Manager is the first (and only) module of the v2 lab shell.
export const modules = {
  projectManager: {
    key: 'projectManager',
    label: 'Projects',
    icon: BriefcaseBusiness,
    basePath: '/overview',
    nav: [
      { label: 'Overview', path: '/overview', icon: LayoutDashboard },
      { label: 'Workspaces', path: '/workspaces', icon: Layers3 },
      { label: 'Projects', path: '/projects', icon: BriefcaseBusiness },
      { label: 'All Work', path: '/work', icon: ListChecks },
      { label: 'Execution', path: '/execution', icon: Rocket },
      { label: 'Timeline', path: '/timeline', icon: GanttChartSquare },
      { label: 'Dependencies', path: '/dependencies', icon: Network },
      { label: 'Milestones', path: '/milestones', icon: Flag },
      { label: 'Repos', path: '/repositories', icon: GitBranch },
      { label: 'Audit', path: '/audit', icon: ScrollText },
      { label: 'Backup', path: '/backup', icon: DatabaseBackup },
      { label: 'Settings', path: '/settings', icon: Settings },
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
