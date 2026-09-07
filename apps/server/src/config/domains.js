import {
  Home,
  LayoutDashboard, BriefcaseBusiness, ListChecks, GanttChartSquare,
  Network, Flag, GitBranch, Rocket, ScrollText, DatabaseBackup, Settings,
  ShoppingCart, Users, Megaphone, UtensilsCrossed, ServerCog, Target,
  FolderOpen, PlugZap, ClipboardCheck, MessagesSquare,
  Workflow, Gauge, TrendingUp,
  PackageCheck, MessageCircle, LayoutGrid, QrCode,
  Warehouse, Truck, ClipboardList,
  Layers, Bot, Cpu, Bookmark, Contact,
} from 'lucide-react'
import { businessHasCapability } from '@/lib/business-capabilities'

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
    // @req FR-166, FR-163 — the slot stops being reserved (ADR-065): sales
    // orders and the payments against them, with revenue counted from verified
    // payments only. `commerce` is the Membership/RBAC route key; the pages
    // exist, so the palette and the bar may now find it.
    // @req FR-167 — labelled `Order Management` since ADR-069: that is the
    // module the owner's SCM row names, and this lane is the one that
    // implements it. The key stays `commerce` (AGENTS.md §18), and the charter
    // is still DOM-COMMERCE.
    key: 'commerce', label: 'Order Management', icon: ShoppingCart, basePath: '/commerce',
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
    // @req FR-171 — labelled `Customer` since ADR-070: CRM became the bar slot
    // over this domain and Market Intelligence, so the leaf and the group
    // cannot both read "CRM" (the same collision ADR-069 D4 fixed for
    // Inventory/Warehouse). The route key stays `customer` (AGENTS.md §18).
    key: 'customer', label: 'Customer', icon: Users, soon: false,
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
      // @req FR-161 — Operations composes Marketing intake, approvals and
      // owner projections without opening a second work system.
      { label: 'Operations', path: '/growth/operations', icon: ClipboardCheck },
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
    key: 'line-oa', label: 'LINE OA Studio', icon: MessageCircle,
    sub: [
      { label: 'Dashboard', path: '/line-oa', icon: LayoutDashboard, exact: true },
      { label: 'บัญชี & กลุ่ม LINE OA', path: '/line-oa/projects', icon: Layers },
      { label: 'Design Studio', path: '/line-oa/design-studio', icon: Bot },
      { label: 'Rich Menu', path: '/line-oa/rich-menus', icon: LayoutGrid },
      { label: 'Live CRM & แชทสด', path: '/line-oa/live-crm', icon: MessagesSquare },
      { label: 'Edge & การเชื่อมต่อ', path: '/line-oa/edge-connection', icon: Cpu },
      { label: 'Integrations & AI', path: '/line-oa/integrations', icon: PlugZap },
      { label: 'Templates', path: '/line-oa/templates', icon: Bookmark },
      { label: 'ทีม', path: '/line-oa/team', icon: Users },
      { label: 'Settings', path: '/line-oa/settings', icon: Settings },
    ],
  },
  {
    // @req FR-154 — Inventory (คลังสินค้า, `DOM-INVENTORY`): catalogue identity
    // (category · family · master · SKU · factory · bundle) and the stock ledger
    // (lot · serial unit · movement) for counted and uncounted products.
    // `inventory` is the Membership/RBAC route key; a Membership grant names it
    // through this registry (FR-061) and the FR-154/FR-155 API refuses a viewer
    // without it.
    // @req FR-167 — the label went back to `Inventory` when SCM became the slot
    // in the bar (ADR-069 D4). It read `Warehouse` from PR #263 because a
    // Project's own `Inventory` section tab (FR-077) sat on screen beside the
    // bar and two links of that name are ambiguous to a screen reader and to
    // Playwright strict mode. Under SCM this list is only on screen while SCM
    // is the selected domain, so the collision is gone — and leaving
    // `Warehouse` on the lane whose warehouse half is the UNBUILT one (see the
    // reserved slot below) was the more confusing of the two names. The key
    // stays `inventory`: keys are immutable (AGENTS.md §18).
    // @spec ADR-025, ADR-069, SEC-001
    // @tested tests/unit/inventory-routes.test.js, tests/unit/scm-group-navigation.test.js
    key: 'inventory', label: 'Inventory', icon: Warehouse, basePath: '/inventory',
    sub: [
      { label: 'Dashboard', path: '/inventory', icon: LayoutDashboard },
    ],
  },
  {
    // @req FR-167 — Warehouse proper: locations, bins, transfers between them
    // and stocktake campaigns. Reserved, not built: `inventory` above holds one
    // Business-wide stock position per SKU, which is the whole of what exists
    // today (`docs/ERP-MODULE-MAP.md` says so in the SCM row). It is declared
    // rather than left out because the owner's SCM row names four modules and a
    // reader looking for Warehouse should find out where it stands here, not by
    // inferring it from an absence. Same shape as the `operations` slot: a
    // reserved key grants nothing while `soon`, and needs no module and no
    // charter until someone builds it.
    // @req FR-169 — additionally gated by the `physicalStock` Business
    // capability (`capability` below), hidden from every menu, not merely
    // disabled, when the Business has turned it off: a service-only Business
    // never runs a warehouse, and a visible-but-reserved slot for a module it
    // will never use is noise, not information — unlike `operations` above,
    // whose slot is reserved because Zuri has not built it yet, not because a
    // Business opted out.
    // @spec ADR-069 D3
    // @tested tests/unit/scm-group-navigation.test.js, tests/unit/business-capability-navigation.test.js
    key: 'warehouse', label: 'Warehouse', icon: LayoutGrid, soon: true, capability: 'physicalStock',
    sub: [{ label: 'Dashboard', path: '/warehouse', icon: LayoutDashboard }],
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

// @req FR-167 — the owner's ERP row "Supply Chain Management (SCM) — Warehouse,
// Inventory, Procurement, Order Management" as one slot in the bar, with those
// four under it (ADR-069).
//
// It is a SEPARATE declaration on purpose, not a nesting of DOMAINS. `DOMAINS`
// is the flat, authoritative list every other consumer walks — above all
// `VIEWER_DOMAINS = DOMAINS.map(d => d.key)`, which FILTERS each Membership's
// persisted grant: a key that stopped appearing there would revoke itself
// silently, on a change that was only ever about navigation. So the group names
// its children by key and the tree is derived, which also means the two cannot
// disagree.
//
// `scm` is a container, never a grant. It is deliberately absent from DOMAINS,
// so it can never reach `domainKeysJson`, the permission checkboxes, or the
// route guard — the guard keeps resolving a path to the LEAF domain and asking
// about that key.
// @spec ADR-069 D1, D2, D6
// @tested tests/unit/scm-group-navigation.test.js
//
// @req FR-171 — a second group, CRM, over Customer and Market Intelligence
// (ADR-070): the same owner instruction ("top nav bar ตามหลัก erp") applied to
// the rest of the bar, walked domain by domain in the ADR's Context table.
// Every other remaining slot already stands as one complete ERP-recognised
// module with no sibling to consolidate, so only this one pair gets a group.
// @spec ADR-070 D1, D2, D6
// @tested tests/unit/crm-group-navigation.test.js
export const DOMAIN_GROUPS = [
  {
    key: 'scm',
    label: 'SCM',
    caption: 'ซัพพลายเชน',
    icon: Layers,
    childKeys: ['inventory', 'warehouse', 'procurement', 'commerce'],
  },
  {
    key: 'crm',
    label: 'CRM',
    caption: 'ลูกค้าและตลาด',
    icon: Contact,
    childKeys: ['customer', 'market'],
  },
]

const GROUP_BY_CHILD_KEY = new Map(
  DOMAIN_GROUPS.flatMap((group) => group.childKeys.map((key) => [key, group])),
)

/** The group a domain belongs to, or null for a domain that stands on its own. */
export function groupForDomainKey(domainKey) {
  return GROUP_BY_CHILD_KEY.get(domainKey) || null
}

/**
 * Whether a domain applies to `business` at all — distinct from
 * `isDomainVisible`, which asks whether THIS VIEWER may open a domain the
 * Business already has. `business` is the raw row (or undefined while it has
 * not loaded); `businessHasCapability` reads its default when it is either,
 * so a domain with no `capability` field is always allowed and one with an
 * unloaded Business is allowed exactly as often as the capability's own
 * default says (FR-169).
 */
export function isDomainAllowedForBusiness(domain, business) {
  return !domain.capability || businessHasCapability(business, domain.capability)
}

/**
 * A group's children, in the order the group names them, skipping unknown
 * keys and any child `business` has not turned on (FR-169). `business` is
 * optional so every existing caller — and every test fixture that predates
 * FR-169 — keeps seeing every child, exactly as `groupChildren(group)` always
 * has.
 */
export function groupChildren(group, business) {
  return group.childKeys
    .map((key) => DOMAINS.find((d) => d.key === key))
    .filter(Boolean)
    .filter((d) => isDomainAllowedForBusiness(d, business))
}

/**
 * The bar's slots: every domain that belongs to no group, in registry order,
 * with each group standing in one place for all of its children — the position
 * of the first child, so the bar's left-to-right reading order is unchanged.
 */
export function domainBarSlots(business) {
  const slots = []
  const placed = new Set()
  for (const domain of DOMAINS) {
    const group = groupForDomainKey(domain.key)
    if (!group) {
      slots.push({ kind: 'domain', domain })
      continue
    }
    if (placed.has(group.key)) continue
    placed.add(group.key)
    slots.push({ kind: 'group', group, children: groupChildren(group, business) })
  }
  return slots
}

/**
 * What the sidebar lists for a path. For a grouped domain that is the whole
 * group — every sibling, each child's label as the section header over its own
 * pages — because a child reached from the bar has to be able to reach the
 * other three. For everything else it is the domain itself, unchanged.
 *
 * The `group` field on each item is the same one the sidebar already renders
 * section headers from, so this needs no new rendering concept. `business` is
 * optional for the same reason it is on `groupChildren` (FR-169): every
 * existing caller keeps its old, unfiltered behaviour.
 */
export function sidebarDomainForPath(pathname, business) {
  const domain = domainForPath(pathname)
  const group = groupForDomainKey(domain.key)
  if (!group) return domain
  return {
    key: group.key,
    label: group.label,
    caption: group.caption,
    icon: group.icon,
    // A child's `Dashboard` is renamed to the child. Every domain's first
    // sub-entry is called Dashboard (ADR-036 D1), so flattening four of them
    // into one menu would put four links called Dashboard in it — ambiguous to
    // a screen reader and to Playwright strict mode, which is the same defect
    // that made this lane's bar label `Warehouse` in the first place.
    sub: groupChildren(group, business).flatMap((child) =>
      child.sub.map((item) => ({
        ...item,
        label: item.label === 'Dashboard' ? child.label : item.label,
        group: child.label,
        soon: child.soon || item.soon,
      })),
    ),
  }
}

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
