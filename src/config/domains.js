import {
  LayoutDashboard, Layers3, BriefcaseBusiness, ListChecks, GanttChartSquare,
  Network, Flag, GitBranch, Rocket, ScrollText, DatabaseBackup, Settings,
  ShoppingCart, Users, Megaphone, UtensilsCrossed, ServerCog,
} from 'lucide-react'

// V2 domain registry (SITEMAP-V2-DOMAIN-NAV.md). Tier 2 = domains (the bar under the
// topbar); Tier 3 = each domain's sub-domains (the left sidebar). The FIRST sub-domain
// of every domain is always its Dashboard. Domains marked `soon` are reserved slots —
// they lift from V1 per module at cutover (ADR-003), hidden/disabled until then.
export const DOMAINS = [
  {
    key: 'commerce', label: 'Commerce', icon: ShoppingCart, soon: true,
    sub: [{ label: 'Dashboard', path: '/commerce', icon: LayoutDashboard }],
  },
  {
    key: 'customer', label: 'Customer', icon: Users, soon: true,
    sub: [{ label: 'Dashboard', path: '/customer', icon: LayoutDashboard }],
  },
  {
    key: 'growth', label: 'Growth', icon: Megaphone, soon: true,
    sub: [{ label: 'Dashboard', path: '/growth', icon: LayoutDashboard }],
  },
  {
    key: 'operations', label: 'Operations', icon: UtensilsCrossed, soon: true,
    sub: [{ label: 'Dashboard', path: '/operations', icon: LayoutDashboard }],
  },
  {
    key: 'projects', label: 'Projects', icon: BriefcaseBusiness,
    sub: [
      { label: 'Dashboard', path: '/overview', icon: LayoutDashboard },
      { label: 'Workspaces', path: '/workspaces', icon: Layers3 },
      { label: 'Projects', path: '/projects', icon: BriefcaseBusiness },
      { label: 'All Work', path: '/work', icon: ListChecks },
      { label: 'Execution', path: '/execution', icon: Rocket },
      { label: 'Timeline', path: '/timeline', icon: GanttChartSquare },
      { label: 'Dependencies', path: '/dependencies', icon: Network },
      { label: 'Milestones', path: '/milestones', icon: Flag },
      { label: 'Repos', path: '/repositories', icon: GitBranch },
    ],
  },
  {
    key: 'platform', label: 'Platform', icon: ServerCog,
    sub: [
      { label: 'Dashboard', path: '/settings', icon: LayoutDashboard },
      { label: 'Audit', path: '/audit', icon: ScrollText },
      { label: 'Backup', path: '/backup', icon: DatabaseBackup },
      { label: 'Settings', path: '/settings', icon: Settings },
    ],
  },
]

// The domain that owns a route — longest matching sub-domain path wins, so /projects
// resolves to Projects even though Platform also has routes. Defaults to Projects.
export function domainForPath(pathname) {
  let best = null
  let bestLen = -1
  for (const d of DOMAINS) {
    for (const item of d.sub) {
      const p = item.path
      if ((pathname === p || pathname.startsWith(`${p}/`)) && p.length > bestLen) {
        best = d
        bestLen = p.length
      }
    }
  }
  return best || DOMAINS.find((d) => d.key === 'projects')
}
