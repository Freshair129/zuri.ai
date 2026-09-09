'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { sidebarDomainForPath } from '@/config/domains'
import { useScope } from '@/context/ScopeContext'

// @req FR-039 — sidebar exposes the active Business domain's sub-domains.
// @spec SDD-018, ADR-011, SITEMAP-V2-DOMAIN-NAV §3
// @tested tests/unit/sidebar-visible-subdomains.test.js
// Tier 3 (SITEMAP-V2): the active domain's labelled sub-domains. Desktop keeps this
// in-flow menu open; the compact icon-only form is reserved for mobile.
// @req FR-167 — for a domain that belongs to a group this lists the WHOLE group
// (ADR-069 D1): each sibling's label as a section header over its own pages, so
// a child reached from the bar can reach the other three. The section header is
// the same `group` field this file already renders, so the group costs no new
// rendering concept. `domainForPath` is untouched and still answers with the
// leaf, which is what the route guard asks about.
export default function Sidebar() {
  const pathname = usePathname()
  // @req FR-169 — capability-gated slots (Warehouse) drop out of the group's
  // own sidebar list the same way they drop out of the bar, from the same
  // Business object, so the two can never disagree about which children exist.
  const scope = useScope()
  const domain = sidebarDomainForPath(pathname, scope.shell.activeBusiness)

  return (
    <aside
      className="nav-glass relative z-30 flex w-64 shrink-0 flex-col overflow-hidden border-r border-white/10 shadow-2xl max-md:w-16"
    >
      <>
        {/* Header: domain context (icon + label + "menu") */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 px-5 max-md:px-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/5 font-bold text-[var(--brand)] shadow-inner">
            <domain.icon className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 max-md:pointer-events-none max-md:opacity-0">
            <span className="block whitespace-nowrap text-base font-bold tracking-tight text-white">{domain.label}</span>
            <span className="mt-0.5 block text-[10px] leading-none text-white/70">menu</span>
          </span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4 [scrollbar-width:none]" aria-label={`${domain.label} sections`}>
          {domain.sub.map((item, index) => {
            const Icon = item.icon
            // @req FR-159 — Marketing's root dashboard must not select itself on Strategy.
            const active = pathname === item.path || (!item.exact && pathname.startsWith(`${item.path}/`))
            // A header marks where a scope group starts. Several Development
            // entries share names with a Project's own Work views on purpose
            // (the global half of the same view) — the header is what tells the
            // reader these operate across all projects, not inside the open one.
            const startsGroup = item.group && item.group !== domain.sub[index - 1]?.group
            return (
              <Fragment key={item.label}>
                {startsGroup && (
                  <p className="px-3 pb-1 pt-4 text-[9px] font-bold uppercase tracking-[0.14em] text-white/40 max-md:hidden">
                    {item.group}
                  </p>
                )}
              {item.soon ? (
                /* @req FR-167 — a reserved sibling is listed and disabled, never
                   linked: it has no page, and a link that 404s is worse than a
                   slot that says it is not built yet (ADR-069 D3). */
                <span
                  aria-label={item.label}
                  aria-disabled="true"
                  title="Reserved — not available yet"
                  className="group relative flex cursor-default items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-white/25 max-md:justify-center"
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden />
                  <span className="truncate font-bold max-md:pointer-events-none max-md:opacity-0">
                    {item.label}
                  </span>
                </span>
              ) : (
              <Link
                href={item.path}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={`group relative flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all duration-300 max-md:justify-center ${
                  active
                    ? 'bg-[var(--brand)] text-[#1A1710] shadow-[0_0_15px_var(--brand-glow)]'
                    : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className={`h-5 w-5 shrink-0 transition-transform ${active ? 'scale-110' : 'group-hover:scale-110'}`} aria-hidden />
                <span className="truncate font-bold max-md:pointer-events-none max-md:opacity-0">
                  {item.label}
                </span>
              </Link>
              )}
              </Fragment>
            )
          })}
        </nav>
      </>
    </aside>
  )
}
