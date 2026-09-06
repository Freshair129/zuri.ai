import {
  Home,
  LayoutDashboard, BriefcaseBusiness, ListChecks, GanttChartSquare,
  Network, Flag, GitBranch, Rocket, ScrollText, DatabaseBackup, Settings,
  ShoppingCart, Users, Megaphone, UtensilsCrossed, ServerCog, Target,
  FolderOpen, PlugZap, ClipboardCheck, MessagesSquare,
  Workflow, Gauge, TrendingUp,
  PackageCheck, MessageCircle, LayoutGrid, QrCode,
  Warehouse, Truck, ClipboardList,
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
// of every operational domain is its `Dashboard` entry — uniformly so since ADR-036 D1
// gave Development the same shape as its peers (FR-086). Domains marked
// `soon` are reserved slots for modules not yet built (ADR-024 — zuri-ai is a
// standalone product with no lift-at-cutover plan), hidden/disabled until then.
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
    // @req FR-162, FR-163 — the slot stops being reserved (ADR-065): sales
    // orders and the payments against them, with revenue counted from verified
    // payments only. `commerce` is the Membership/RBAC route key; the pages
    // exist, so the palette and the bar may now find it.
    key: 'commerce', label: 'Commerce', icon: ShoppingCart, basePath: '/commerce',
    sub: [
      { label: 'Dashboard', path: '/commerce', icon: LayoutDashboard },
      { label: 'Orders', path: '/commerce/orders', icon: ClipboardCheck },
    ],
  },
  {
    // @req FR-091 — the slot stops being reserved. `Customer`, `Conversation` and
    // `Message` have been written by the FR-023 LINE ingest since the first turn;
    // FR-081 left them deliberately unreadable, so this domain was `soon` while its
    // data was already arriving. The Inbox is the reader surface that closes that.
    key: 'customer', label: 'CRM', icon: Users, soon: false,
    sub: [
      { label: 'Dashboard', path: '/customer', icon: LayoutDashboard },
      { label: 'Inbox', path: '/customer/conversations', icon: MessagesSquare },
      // @req FR-161 — sales tasks: the follow-ups a salesperson owes customers,
      // a CRM activity record and deliberately not a Development WorkItem
      // (ADR-064). Listed only now that its page exists.
      { label: 'Sales Tasks', path: '/customer/sales-tasks', icon: ListChecks },
    ],
  },
  {
    key: 'market', label: 'Market Intelligence', icon: TrendingUp, soon: false,
    sub: [
      { label: 'Dashboard', path: '/market', icon: LayoutDashboard },
    ],
  },
  {
    // @req FR-159, FR-160 — expose the functional Strategy and Campaign slices under the existing growth grant.
    // @tested tests/unit/marketing-navigation.test.js
    key: 'growth', label: 'Marketing', icon: Megaphone, soon: false,
    sub: [
      { label: 'Dashboard', path: '/growth', icon: LayoutDashboard, exact: true },
      { label: 'Strategy', path: '/growth/strategy', icon: Target },
      { label: 'Campaigns', path: '/growth/campaigns', icon: Megaphone },
      // @req FR-157 — Content owns creative intent; Files/PM remain referenced owners.
      { label: 'Content & Creative', path: '/growth/content', icon: FolderOpen },
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
    // Five of these entries are the cross-project halves of views a Project also
    // carries under its Work tab (FR-005/006/007/009/064 global + project-scoped
    // split). `group` renders as a sidebar section header naming that scope —
    // without it the sidebar reads as a duplicate of the project's own Work
    // views.
    //
    // These labels stay DIFFERENT from the project-scoped ones on purpose, and
    // `project-work-route.test.js` enforces it against this very list. An
    // earlier revision of this file renamed `/timeline` to "Schedule" so one
    // view would carry one name at both scopes; that is the wrong trade here.
    // Both bars are on screen at the same time, so an identical label is
    // genuinely ambiguous — to a screen-reader user reading two "Schedule"
    // links, and to Playwright strict mode, which is what surfaced it. The
    // shared vocabulary lives in the page *heading* instead: `/timeline` is
    // titled Schedule at both scopes, while the two navigation entries stay
    // Timeline and Schedule.
    sub: [
      // @req FR-086 — labelled `Dashboard`, decided by ADR-036 D1 on 2026-08-19.
      // Every peer domain's first sidebar entry is already `Dashboard`, so this
      // gives Development the same shape; and "Overview" stays reserved for
      // `/overview`, Business Home's cross-domain Dashboard, which FR-060
      // deliberately separated from Development — naming this one "Overview"
      // would have given the product two. The path is untouched: `/projects` is
      // a route key (AGENTS.md §18) and every inbound link, the route guard and
      // the command palette resolve on it.
      // The icon moves to `LayoutDashboard` for the same reason as the label:
      // it is what every other domain's Dashboard entry uses, and
      // `BriefcaseBusiness` is Development's own icon in the domain bar above —
      // reusing it one level down printed the domain's mark twice for two
      // different things.
      { label: 'Dashboard', path: '/projects', icon: LayoutDashboard },
      { label: 'All Work', path: '/work', icon: ListChecks, group: 'All projects' },
      { label: 'Execution', path: '/execution', icon: Rocket, group: 'All projects' },
      { label: 'Timeline', path: '/timeline', icon: GanttChartSquare, group: 'All projects' },
      { label: 'Dependencies', path: '/dependencies', icon: Network, group: 'All projects' },
      { label: 'Milestones & Gates', path: '/milestones', icon: Flag, group: 'All projects' },
      { label: 'Files', path: '/files', icon: FolderOpen, group: 'Business' },
      { label: 'Repositories', path: '/repositories', icon: GitBranch, group: 'Business' },
    ],
  },
  {
    // @req FR-133 — a first-class physical-asset domain. `assets` is the
    // Membership/RBAC route key; `DOM-ASSET-MANAGEMENT` is its stable product id.
    // @spec ADR-055, SDD-078, SEC-023
    // @tested tests/unit/asset-management-navigation.test.js
    key: 'assets', label: 'Asset Management', icon: PackageCheck, basePath: '/assets',
    sub: [
      { label: 'Dashboard', path: '/assets', icon: LayoutDashboard },
      { label: 'Receiving & Inspection', path: '/assets/receiving', icon: ClipboardCheck },
      { label: 'Asset Register', path: '/assets/register', icon: PackageCheck },
      { label: 'Stocktake Scanner', path: '/assets/scanner', icon: QrCode },
    ],
  },
  {
    // @req FR-146 — LINE OA Studio (ADR-060, `DOM-LINE-OA-STUDIO`). A reserved
    // slot on purpose: `soon` keeps it out of the bar and the palette (ADR-060
    // D12 — no fake clickable surface before its pages exist), while the key
    // being in the registry is what lets a Membership grant name the domain
    // (FR-061 filters grants through this list) and lets the FR-146 API refuse
    // a viewer without it. The page tree lands with the Phase 1 UI slice.
    key: 'line-oa', label: 'LINE OA Studio', icon: MessageCircle,
    sub: [
      { label: 'Dashboard', path: '/line-oa', icon: LayoutDashboard },
      // FR-151 — the rich menu designer's own page. Listed only now that it
      // exists: the note above is about not advertising a route before its
      // page lands, and this one has landed.
      { label: 'Rich Menu', path: '/line-oa/rich-menus', icon: LayoutGrid },
    ],
  },
  {
    // @req FR-154 — Inventory (คลังสินค้า, `DOM-INVENTORY`): catalogue identity
    // (category · family · master · SKU · factory · bundle) and the stock ledger
    // (lot · serial unit · movement) for counted and uncounted products.
    // `inventory` is the Membership/RBAC route key; a Membership grant names it
    // through this registry (FR-061) and the FR-154/FR-155 API refuses a viewer
    // without it.
    // The label is `Warehouse`, not `Inventory`, for the same reason Timeline
    // and Schedule differ above: a Project already carries an `Inventory`
    // section tab (FR-077, Project Inventory) that is on screen at the same
    // time as this bar, and two links named Inventory are ambiguous — to a
    // screen-reader user and to Playwright strict mode, which is what surfaced
    // it on PR #263's first CI run. The key stays `inventory` (keys are
    // immutable, AGENTS.md §18); คลังสินค้า is literally a warehouse anyway.
    // @spec ADR-025, SEC-001
    // @tested tests/unit/inventory-routes.test.js
    key: 'inventory', label: 'Warehouse', icon: Warehouse, basePath: '/inventory',
    sub: [
      { label: 'Dashboard', path: '/inventory', icon: LayoutDashboard },
    ],
  },
  {
    // @req FR-164, FR-165 — Procurement (`DOM-PROCUREMENT`, ADR-066): the buy
    // side — suppliers, purchase orders and the goods receipts that post
    // RECEIPT rows into the Inventory ledger. `procurement` is the
    // Membership/RBAC route key; a Membership grant names it through this
    // registry (FR-061) and the FR-164/FR-165 API refuses a viewer without it.
    // Listed after Warehouse on purpose: a receipt is the one thing that
    // increases what the warehouse holds, and the two bars read left to right
    // as "what we hold" → "what we are buying". Commerce (the sell side) stays
    // where it is; the three lanes meet only in the ledger.
    // @spec ADR-025, SEC-001
    // @tested tests/unit/procurement-routes.test.js
    key: 'procurement', label: 'Procurement', icon: Truck, basePath: '/procurement',
    sub: [
      { label: 'Dashboard', path: '/procurement', icon: LayoutDashboard },
      { label: 'Purchase Orders', path: '/procurement/purchase-orders', icon: ClipboardList },
    ],
  },
  {
    key: 'platform', label: 'Platform', icon: ServerCog,
    sub: [
      { label: 'Dashboard', path: '/settings', icon: LayoutDashboard },
      // @req FR-124 — an additional Platform sub-domain, deliberately not a new
      // top-level domain and not a replacement for the Dashboard slot above it.
      { label: 'Product Readiness', path: '/platform/product-readiness', icon: Gauge },
      { label: 'Users', path: '/platform/users', icon: Users },
      { label: 'Integrations', path: '/platform/integrations', icon: PlugZap },
      { label: 'Customer Review', path: '/platform/customer-import-reviews', icon: ClipboardCheck },
      { label: 'SoT Pipeline', path: '/platform/sot-pipeline', icon: Workflow },
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
