'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { domainForPath } from '@/config/domains'

// @req FR-039 — sidebar exposes the active Business domain's sub-domains.
// @spec SDD-018, ADR-011, SITEMAP-V2-DOMAIN-NAV §3
// @tested tests/unit/sidebar-visible-subdomains.test.js
// Tier 3 (SITEMAP-V2): the active domain's labelled sub-domains. Desktop keeps this
// in-flow menu open; the compact icon-only form is reserved for mobile.
export default function Sidebar() {
  const pathname = usePathname()
  const domain = domainForPath(pathname)

  return (
    <aside
      className="nav-glass relative z-30 flex w-56 shrink-0 flex-col overflow-hidden border-r border-white/10 shadow-2xl max-md:w-16"
    >
      <>
        {/* Header: domain context (icon + label + "menu") */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 px-4 max-md:px-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/5 font-bold text-[var(--brand)] shadow-inner">
            <domain.icon className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 max-md:pointer-events-none max-md:opacity-0">
            <span className="block whitespace-nowrap text-sm font-bold tracking-tight text-white">{domain.label}</span>
          </span>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3 [scrollbar-width:none]" aria-label={`${domain.label} sections`}>
          {domain.sub.map((item) => {
            const Icon = item.icon
            const active = pathname === item.path || pathname.startsWith(`${item.path}/`)
            return (
              <Link
                key={item.label}
                href={item.path}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors max-md:justify-center ${
                  active
                    ? 'bg-[rgba(232,130,12,0.12)] text-[var(--brand)]'
                    : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate max-md:pointer-events-none max-md:opacity-0">
                  {item.label}
                </span>
              </Link>
            )
          })}
        </nav>
      </>
    </aside>
  )
}
