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
          {domain.sub.map((item) => {
            const Icon = item.icon
            const active = pathname === item.path || pathname.startsWith(`${item.path}/`)
            return (
              <Link
                key={item.label}
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
            )
          })}
        </nav>
      </>
    </aside>
  )
}
