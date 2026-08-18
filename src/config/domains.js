import {
  Home,
  LayoutDashboard, BriefcaseBusiness, ListChecks, GanttChartSquare,
  Network, Flag, GitBranch, Rocket, ScrollText, DatabaseBackup, Settings,
  ShoppingCart, Users, Megaphone, UtensilsCrossed, ServerCog, Target,
  FolderOpen, PlugZap,
} from 'lucide-react'

// @req FR-042 - HR / People is a peer domain with route key `people`.
// @req FR-045 - Files is a Business-scoped Development subdomain.
// @spec ADR-013, SITEMAP-V2-DOMAIN-NAV
// @tested tests/unit/domain-navigation.test.js, tests/unit/fr045-api-ui-contract.test.js, tests/e2e/fr041-business-first.spec.js

// @req FR-039 — Business-bound ERP domains use display labels without changing route keys.
// @spec SDD-018, ADR-011
// @tested tests/unit/domain-navigation.test.js
// V2 domain registry (SITEMAP-V2-DOMAIN-NAV.md). Tier 2 = domains (the bar under the
// topbar); Tier 3 = each domain's sub-domains (the left sidebar). The FIRST sub-domain
// of every operational domain is its Dashboard or Overview entry. Domains marked
// `soon` are reserved slots — they lift from V1 per module at cutover (ADR-003),
// hidden/disabled until then.
export const DOMAINS = [
  {
    // @req FR-060 — Business Home is the shell-level cross-domain slot, first in
    // the bar. Its Dashboard is `/overview`, which already was the Business
    // strategy + domain-health surface; FR-060 promoted it here rather than
    // adding a second Business-scoped page beside it (feature note, Decision 1).
    // Development consequently no longer roots at `/overview` — see below.
    // `alwaysVisible` because Business Home is the Business's landing surface,
    // not a capability you grant. A MEMBER whose Membership lists only
    // `projects` must still be able to land somewhere after choosing a
    // Business; gating this slot on domainKeysJson would hand them a Business
    // they can enter and no page to enter it at.
    key: 'business-home', label: 'Business Home', icon: Home, basePath: '/overview', alwaysVisible: true,
    sub: [{ label: 'Dashboard', path: '/overview', icon: LayoutDashboard }],
  },
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
    // display label changes so the resource list stays Projects.
    // @req FR-060 — Development's root moved off `/overview` to `/projects`.
    // `/overview` is cross-domain (strategy, per-domain health, attention
    // queue) and now belongs to Business Home; leaving Development rooted there
    // would have kept one page answering to two domains, which is how the two
    // surfaces would have drifted apart.
    key: 'projects', label: 'Development', icon: BriefcaseBusiness, basePath: '/projects',
    sub: [
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
  {
    key: 'platform', label: 'Platform', icon: ServerCog,
    sub: [
      { label: 'Dashboard', path: '/settings', icon: LayoutDashboard },
      { label: 'Users', path: '/platform/users', icon: Users },
      { label: 'Integrations', path: '/platform/integrations', icon: PlugZap },
      { label: 'Audit', path: '/audit', icon: ScrollText },
      { label: 'Backup', path: '/backup', icon: DatabaseBackup },
      { label: 'Settings', path: '/settings', icon: Settings },
    ],
  },
]

/**
 * Whether a viewer may see a domain.
 *
 * @req FR-060 — one predicate for both the domain bar and the route guard, so
 * an `alwaysVisible` slot cannot be honoured by one and denied by the other.
 * A viewer with no `visibleDomains` array at all is an old fixture, treated as
 * unrestricted exactly as `business-shell-guard` already did.
 */
export function isDomainVisible(domainKey, visibleDomainKeys) {
  const domain = DOMAINS.find((d) => d.key === domainKey)
  if (domain?.alwaysVisible) return true
  if (!Array.isArray(visibleDomainKeys)) return true
  return visibleDomainKeys.includes(domainKey)
}

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
