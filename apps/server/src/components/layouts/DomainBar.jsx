'use client'

// @req FR-038 — domain navigation is filtered by the resolved viewer grant.
// @spec SDD-017, docs/features/FR-038-profile-and-permissions.md
// @tested tests/unit/profile-permission-service.test.js
// @req FR-061 — that grant is read per Business, the same question the route
// guard asks. Unchanged from before: while `/api/viewer` is in flight there is
// no viewer to ask, so the bar renders unfiltered for that tick and narrows on
// arrival. The guard, not the bar, is what actually denies a route.
// @spec SDD-034
// @tested tests/unit/fr061-per-business-domain-visibility.test.js

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { domainBarSlots, domainForPath, isDomainVisible } from '@/config/domains'
import { domainsForBusiness } from '@/modules/identity/viewer-domains'
import { useScope } from '@/context/ScopeContext'
import { useFetch } from '@/modules/project-manager/components/useApi'

// Tier 2 (SITEMAP-V2): the domain bar. It is the "original" module layer (V1 kept its
// module tabs in the topbar); V2 lifts it into its own chrome bar, tinted a shade
// LIGHTER than the workspace/scope topbar above it, so the two chrome layers alternate
// and the workspace layer visibly wraps the domain layer. Picking a domain lands on its
// root path (Business Overview for Development, otherwise the first sub-domain).
// `soon` domains are visible but disabled.
// @tested tests/unit/domain-navigation.test.js, tests/e2e/fr041-business-first.spec.js
export default function DomainBar() {
  const pathname = usePathname()
  const activeKey = domainForPath(pathname).key
  const viewer = useFetch('/api/viewer')
  // @req FR-061 — the bar shows the domains granted in THIS Business, matching
  // what BusinessShellGuard will allow. Reading the flat `visibleDomains` here
  // put tabs in the bar that the guard then refused with DOMAIN_ACCESS.
  // `selection.businessId` deliberately, not `shell.activeBusinessId`: the bar
  // must reflect the Business the guard authorized, not one the shell derived.
  //
  // "Not loaded yet" is not a denial. `domainsForBusiness` fails closed on an
  // absent viewer — correct for the guard, wrong here: asking before the fetch
  // lands emptied the bar down to Business Home for several seconds, and every
  // click had to wait it out. The bar is chrome; the guard is what denies. So
  // ask only once there is a viewer to ask, and stay unfiltered until then,
  // exactly as before FR-061.
  const scope = useScope()
  const granted = viewer.data ? domainsForBusiness(viewer.data, scope.selection?.businessId) : undefined
  // @req FR-169 — Warehouse's slot is capability-gated on top of being grant-gated;
  // `domainBarSlots` reads `scope.shell.activeBusiness` itself to decide whether
  // the Business has turned `physicalStock` on, independently of who may open it.
  const business = scope.shell.activeBusiness

  return (
    <nav
      aria-label="Domains"
      className="flex h-14 shrink-0 items-center gap-1 overflow-x-auto border-b border-black/25 px-3 text-white"
      style={{ background: '#2b3646' }}
    >
      {/* @req FR-167 — a group stands in the bar for its children (ADR-069 D1).
          It is visible when any child is, because the group itself is never a
          grant (D6); it is active when the path resolves to any child, because
          `domainForPath` answers with the LEAF, which is also the key the route
          guard checks; and it links to the first child a viewer may actually
          open, so the slot never lands on a domain they will be refused. */}
      {domainBarSlots(business).map((slot) => {
        if (slot.kind === 'group') {
          const { group, children } = slot
          const visibleChildren = children.filter((child) => isDomainVisible(child.key, granted))
          if (visibleChildren.length === 0) return null
          const target = visibleChildren.find((child) => !child.soon)
          if (!target) return null
          const isActive = children.some((child) => child.key === activeKey)
          const Icon = group.icon
          const cls = `flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            isActive
              ? 'bg-[rgba(232,130,12,0.18)] text-[var(--brand)]'
              : 'text-white/55 hover:bg-white/10 hover:text-white'
          }`
          return (
            <Link
              key={group.key}
              href={target.basePath || target.sub[0].path}
              className={cls}
              aria-current={isActive ? 'page' : undefined}
              title={group.caption}
            >
              <Icon size={15} aria-hidden /> {group.label}
            </Link>
          )
        }
        const d = slot.domain
        if (!isDomainVisible(d.key, granted)) return null
        const Icon = d.icon
        const isActive = d.key === activeKey
        const cls = `flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
          isActive
            ? 'bg-[rgba(232,130,12,0.18)] text-[var(--brand)]'
            : 'text-white/55 hover:bg-white/10 hover:text-white'
        }`
        if (d.soon) {
          return (
            <span key={d.key} className={`${cls} cursor-default text-white/30 hover:bg-transparent hover:text-white/30`} title="Reserved — not available yet">
              <Icon size={15} aria-hidden /> {d.label}
            </span>
          )
        }
        return (
          <Link key={d.key} href={d.basePath || d.sub[0].path} className={cls} aria-current={isActive ? 'page' : undefined}>
            <Icon size={15} aria-hidden /> {d.label}
          </Link>
        )
      })}
    </nav>
  )
}
