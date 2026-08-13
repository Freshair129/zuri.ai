import {
  LayoutDashboard, BriefcaseBusiness, ListChecks, GanttChartSquare,
  Network, Flag, GitBranch, Rocket, ScrollText, DatabaseBackup, Settings,
  ShoppingCart, Users, Megaphone, UtensilsCrossed, ServerCog, Target,
} from 'lucide-react'

// @req FR-042 - HR / People is a peer domain with route key `people`.
// @spec ADR-013, SITEMAP-V2-DOMAIN-NAV
// @tested tests/unit/domain-navigation.test.js, tests/e2e/fr041-business-first.spec.js

// @req FR-039 — Business-bound ERP domains use display labels without changing route keys.
// @spec SDD-018, ADR-011
// @tested tests/unit/domain-navigation.test.js
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
    key: 'customer', label: 'CRM', icon: Users, soon: true,
    sub: [{ label: 'Dashboard', path: '/customer', icon: LayoutDashboard }],
  },
  {
    key: 'growth', label: 'Marketing', icon: Megaphone, soon: true,
    sub: [
      { label: 'Dashboard', path: '/growth', icon: LayoutDashboard },
      // Campaign belongs to marketing (HubSpot-style), NOT the Projects/WBS domain.
      { label: 'Campaigns', path: '/growth/campaigns', icon: Target },
    ],
  },
  {
    key: 'operations', label: 'Operations', icon: UtensilsCrossed, soon: true,
    sub: [{ label: 'Dashboard', path: '/operations', icon: LayoutDashboard }],
  },
  {
    // HR / People is a Business domain peer of Development. The internal key is
    // deliberately `people` so it does not collide with a future `/hr` module.
    key: 'people', label: 'HR / People', icon: Users, soon: false,
    sub: [
      { label: 'Dashboard', path: '/people', icon: LayoutDashboard },
      { label: 'People Directory', path: '/people/directory', icon: Users },
    ],
  },
  {
    // Existing route/RBAC key remains `projects`; only its Business-bound
    // display label changes so the resource list stays Projects. `/overview`
    // is the BusinessShell root, not a Development sub-domain.
    key: 'projects', label: 'Development', icon: BriefcaseBusiness, basePath: '/overview',
    sub: [
      { label: 'Projects', path: '/projects', icon: BriefcaseBusiness },
      { label: 'All Work', path: '/work', icon: ListChecks },
      { label: 'Execution', path: '/execution', icon: Rocket },
      { label: 'Timeline', path: '/timeline', icon: GanttChartSquare },
      { label: 'Dependencies', path: '/dependencies', icon: Network },
      { label: 'Milestones & Gates', path: '/milestones', icon: Flag },
      { label: 'Repositories', path: '/repositories', icon: GitBranch },
    ],
  },
  {
    key: 'platform', label: 'Platform', icon: ServerCog,
    sub: [
      { label: 'Dashboard', path: '/settings', icon: LayoutDashboard },
      { label: 'Users', path: '/platform/users', icon: Users },
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
